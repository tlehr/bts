"""Embedded in the personal .sh download; standard Python only, no pip/rootfs installs on the host."""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shlex
import shutil
import signal
import ssl
import subprocess
import sys
import tarfile
import time
import uuid
from urllib.parse import urlsplit


def config_check(config):
    url = urlsplit(config["endpoint"])
    if (config.get("protocol") != 1 or url.scheme not in ("https", "http") or not url.hostname
            or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment
            or not re.fullmatch(r"[a-f0-9]{64}", config["runtime"]["sha256"])
            or not re.fullmatch(r"[a-f0-9]{64}", config["runtime"]["id"])
            or not 1024 <= config["runtime"]["size_bytes"] <= 8 * 1024**3):
        raise ValueError("Die Starter-Konfiguration ist ungueltig.")
    if url.scheme == "https" and not re.fullmatch(r"[a-f0-9]{64}", config.get("certificate_sha256", "")):
        raise ValueError("BTS-Zertifikat fehlt.")
    return config


def own_root(config):
    base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local/share"))
    if not base.is_absolute():
        raise ValueError("XDG_DATA_HOME muss ein absoluter Pfad sein.")
    server = hashlib.sha256(config["endpoint"].encode()).hexdigest()[:12]
    return base / "bts-sprachhelfer" / server


def plan(config, root, threads, memory):
    print("\nBTS-Sprachhelfer fuer Linux - freiwillige CPU-Sprachgenerierung")
    print("BTS:", config["endpoint"])
    print("Eigene Daten:", root)
    print("Freigegeben: %s CPU-Kerne; %s MiB Modell-RAM-Abbruchgrenze." % (threads, memory))
    print("Erst 'Starten' beginnt mit Download und Einrichtung. Laufzeit: %.1f GiB, insgesamt etwa 5-6 GiB Plattenplatz pro Version." % (config["runtime"]["size_bytes"] / 1024**3))
    print("Python 3.8+ und Bubblewrap werden benoetigt. Modelle und Linux-Bibliotheken kommen fertig vom BTS, kein pip oder Docker.")
    print("Die Laufzeit sieht keine persoenlichen Dateiordner. Ihr Netzwerk wird fuer die Verbindung zu BTS mitbenutzt.")
    print("Der Helfer empfaengt Durchsagetexte einschliesslich Spielernamen und generiert daraus Aufnahmen.")
    print("BTS erhaelt Rechnername, Geraetekennung, Plattform, Ressourcenwahl, Status und die erzeugten Kontext- und Testaufnahmen.")
    print("Die CPU-Auswahl wird durch Prozessaffinitaet begrenzt. Die Modell-RAM-Grenze wird bei Modellstart/Generierung etwa alle 250 ms ueberwacht;")
    print("Ueberschreitung beendet das Modell. Kurzes Ueberschreiten ist moeglich; Laufzeit und Dateicaches brauchen weiteren RAM.")
    print("Strg+C stoppt die Arbeit; Downloads bleiben zum Fortsetzen erhalten. Kein Autostart, kein Dienst und keine globale Systemkonfiguration.")
    print("'Entfernen' loescht nur die oben genannten eigenen Daten samt Modellen, Downloads und Sitzung. Systempakete bleiben erhalten.")
    print("Die heruntergeladene .sh anschliessend selbst loeschen. Rechnerangaben und fertige Audios bleiben im BTS.")
    if config["endpoint"].startswith("http:"):
        print("ACHTUNG: Diese BTS-Adresse verwendet HTTP. Zugangsdaten, Texte und Audios werden unverschluesselt uebertragen.")


def cpu_count():
    return len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)


def memory_info():
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        name, value = line.split(":", 1)
        values[name] = int(value.split()[0]) // 1024
    return values["MemTotal"], values["MemAvailable"]


def cpu_times():
    values = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    # guest/guest_nice are already included in user/nice. Treat iowait as idle.
    return sum(values[:8]), values[3] + values[4]


def recommend():
    print("Lokale Lastmessung, 5 Sekunden. Keine Aenderungen oder Datenuebertragung; Strg+C bricht ab.")
    total, free = memory_info()
    before = cpu_times()
    loads = []
    for _ in range(5):
        time.sleep(1)
        after = cpu_times()
        elapsed, idle = after[0] - before[0], after[1] - before[1]
        if elapsed <= 0 or not 0 <= idle <= elapsed:
            raise ValueError("CPU-Last konnte nicht verlaesslich ermittelt werden.")
        loads.append(100 * (1 - idle / elapsed))
        free = min(free, memory_info()[1])
        before = after
    count = cpu_count()
    threads = min(4, count // 2, count * max(0, 65 - math.ceil(max(loads))) // 100)
    reserve = math.ceil(max(2048, min(8192, total * .20)) / 256) * 256
    print("CPU im Mittel %.0f%%, Spitze %.0f%%; mindestens %.1f GiB RAM frei." % (sum(loads) / 5, max(loads), free / 1024))
    print("Reserve: %.1f GiB fuer weitere Nutzung, zusaetzlich 1 GiB fuer Laufzeit/Dateicaches. Momentaufnahme, keine Leistungsgarantie." % (reserve / 1024))
    if threads < 1 or free - reserve - 1024 < 3584:
        print("Zurzeit besser warten: zu wenig Reserve. Manuelle Auswahl bleibt moeglich.")
        return None
    print("Vorschlag: %s CPU-Kerne, 3584 MiB Modell-RAM. Noch keine Werte geaendert." % threads)
    return threads, 3584, time.monotonic()


def confirm(message):
    return input(message + " [ja/NEIN]: ").strip().lower() == "ja"


def prerequisites():
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Das Laufzeitpaket benoetigt Linux x86_64; ARM wird derzeit nicht unterstuetzt.")
    if os.geteuid() == 0:
        raise RuntimeError("Bitte als normaler Benutzer starten, nicht mit sudo/root.")
    if not shutil.which("bwrap"):
        managers = (("apt-get", ["apt-get", "install", "--no-install-recommends", "bubblewrap"]),
                    ("dnf", ["dnf", "install", "bubblewrap"]), ("zypper", ["zypper", "install", "bubblewrap"]),
                    ("pacman", ["pacman", "-S", "bubblewrap"]))
        install = next((args for name, args in managers if shutil.which(name)), None)
        if not install or not shutil.which("sudo"):
            raise RuntimeError("Bitte Bubblewrap mit dem Paketmanager Ihrer Distribution installieren und den Starter erneut oeffnen.")
        command = ["sudo"] + install
        print("Bubblewrap fehlt. Installation eines Systempakets aus Ihren eingerichteten Paketquellen:", shlex.join(command))
        print("Der Paketmanager kann weitere Abhaengigkeiten laden. Das Paket bleibt bei 'Helfer entfernen' installiert.")
        if not confirm("Installation jetzt mit Administratorrechten anfordern?"):
            raise RuntimeError("Keine Installation gestartet.")
        if subprocess.call(command) != 0 or not shutil.which("bwrap"):
            raise RuntimeError("Bubblewrap konnte nicht installiert werden.")
    test = subprocess.run(["bwrap", "--unshare-user", "--unshare-pid", "--ro-bind", "/", "/", "--", "/bin/true"],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
    if test.returncode:
        raise RuntimeError("Bubblewrap kann auf diesem System keinen isolierten Prozess starten: " + test.stderr.strip()[:500] +
                           "\nBitte die distributionsspezifischen Bubblewrap/AppArmor-Voraussetzungen pruefen. Der Starter lockert keine globalen Schutzregeln.")


@contextlib.contextmanager
def installation_lock(root, create):
    if root.is_symlink() or root.parent.is_symlink():
        raise RuntimeError("Der Helferordner ist eine Verknuepfung; Vorgang wurde gestoppt.")
    if create:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not root.exists():
        yield False
        return
    if root.stat().st_uid != os.getuid():
        raise RuntimeError("Der Helferordner gehoert einem anderen Benutzer.")
    lockfile = root / "starter.lock"
    descriptor = os.open(str(lockfile), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Ein Helfer fuer diesen BTS laeuft bereits. Bitte dort zuerst stoppen.") from None
        yield True


def marker(root, config, create=False):
    expected = {"kind": "bts-speech-helper-linux-v1", "endpoint": config["endpoint"]}
    target = root / "installation.json"
    if target.is_symlink():
        raise RuntimeError("Ungueltige Installationsmarkierung.")
    if target.exists():
        if json.loads(target.read_text()) != expected:
            raise RuntimeError("Der Ordner enthaelt eine andere Installation; Vorgang abgebrochen.")
    elif create and set(path.name for path in root.iterdir()) <= {"starter.lock"}:
        target.write_text(json.dumps(expected))
    else:
        raise RuntimeError("Eigene Installationsmarkierung fehlt; vorhandene Daten werden nicht veraendert.")


def remove(root, config):
    if not root.exists() and not root.is_symlink():
        print("Keine lokale Installation vorhanden. Die .sh koennen Sie selbst loeschen.")
        return
    if root.is_symlink() or root.parent.is_symlink():
        raise RuntimeError("Der Helferordner ist eine Verknuepfung; Entfernung gestoppt.")
    marker(root, config)
    print("Geloescht werden nur eigene Daten unter", root)
    print("Systempakete, diese .sh und bereits an BTS gesendete Aufnahmen bleiben erhalten.")
    if not confirm("Helfer samt Modellen, Download, Einstellungen und Sitzung endgueltig entfernen?"):
        print("Nichts entfernt.")
        return
    with installation_lock(root, False):
        marker(root, config)
        shutil.rmtree(root)
    print("Lokaler Helfer entfernt. Die heruntergeladene .sh koennen Sie jetzt selbst loeschen.")


def digest_file(filename):
    sha = hashlib.sha256()
    with filename.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def connect(config):
    url = urlsplit(config["endpoint"])
    if url.scheme == "https":
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connection = http.client.HTTPSConnection(url.hostname, url.port, context=context, timeout=30)
        connection.connect()
        actual = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
        if actual != config["certificate_sha256"]:
            connection.close()
            raise RuntimeError("Das BTS-Zertifikat stimmt nicht. Bitte einen neuen Starter vom BTS herunterladen.")
    else:
        connection = http.client.HTTPConnection(url.hostname, url.port, timeout=30)
    return connection


def download(config, target, key):
    expected = config["runtime"]["size_bytes"]
    offset = target.stat().st_size if target.exists() else 0
    if offset > expected:
        raise RuntimeError("Teildownload ist zu gross. Bitte Helfer entfernen und erneut starten.")
    if offset == expected:
        return
    connection = connect(config)
    try:
        headers = {"Authorization": "Bearer " + key}
        if offset:
            headers["Range"] = "bytes=%s-" % offset
        connection.request("GET", "/speech-helper/v1/runtime", headers=headers)
        response = connection.getresponse()
        if response.status not in (200, 206):
            raise RuntimeError("Download abgelehnt (HTTP %s). Bei abgelaufener Kopplung bitte einen neuen Starter laden." % response.status)
        append = response.status == 206 and offset > 0
        if response.status == 206 and (not append or not response.getheader("Content-Range", "").startswith("bytes %s-" % offset)):
            raise RuntimeError("Ungueltige Download-Fortsetzung.")
        current = offset if append else 0
        if int(response.getheader("Content-Length", "-1")) != expected - current:
            raise RuntimeError("Download-Groesse stimmt nicht mit dem Starter ueberein.")
        started, last, initial = time.monotonic(), 0, current
        with target.open("ab" if append else "wb") as output:
            while True:
                block = response.read(131072)
                if not block:
                    break
                current += len(block)
                if current > expected:
                    raise RuntimeError("Download ist groesser als erwartet.")
                output.write(block)
                elapsed = max(.001, time.monotonic() - started)
                if elapsed - last >= .5:
                    print("\rDownload: %.0f%% - %.0f / %.0f MiB - %.1f MiB/s" %
                          (100 * current / expected, current / 1024**2, expected / 1024**2, (current - initial) / elapsed / 1024**2), end="", flush=True)
                    last = elapsed
        print()
        if current != expected:
            raise RuntimeError("Download unterbrochen. Beim naechsten Start wird er fortgesetzt.")
    finally:
        connection.close()


def unpack(archive, destination):
    # No owner restoration, devices, hardlinks or arbitrary symlinks. Do not
    # depend on Python 3.12's extraction filter on older Linux distributions.
    destination.mkdir(mode=0o700)
    allowed_links = {"usr/bin/python3": "python3.12", "bin/sh": "bash"}
    with tarfile.open(archive) as source:
        for entry in source:
            relative = PurePosixPath(entry.name)
            if relative.is_absolute() or ".." in relative.parts or "\\" in entry.name:
                raise RuntimeError("Ungueltiger Pfad in der Laufzeit.")
            target = destination.joinpath(*relative.parts)
            for parent in [target] + list(target.parents):
                if parent == destination.parent:
                    break
                if parent.is_symlink():
                    raise RuntimeError("Unerwartete Verknuepfung in der Laufzeit.")
            if entry.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            elif entry.isfile():
                if target.exists():
                    raise RuntimeError("Doppelte Datei in der Laufzeit.")
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.extractfile(entry) as content, target.open("xb") as output:
                    shutil.copyfileobj(content, output, 1024 * 1024)
                target.chmod(entry.mode & 0o777)
            elif entry.issym() and allowed_links.get(entry.name) == entry.linkname:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                target.symlink_to(entry.linkname)
            else:
                raise RuntimeError("Nicht unterstuetzter Eintrag in der Laufzeit.")


def prepare(config, root):
    sha, size = config["runtime"]["sha256"], config["runtime"]["size_bytes"]
    runtime = root / ("runtime-" + sha)
    if runtime.is_symlink():
        raise RuntimeError("Die Laufzeit ist eine Verknuepfung; Vorgang abgebrochen.")
    if (runtime / ".bts-complete").is_file() and (runtime / ".bts-complete").read_text() == sha:
        return runtime
    if runtime.exists():
        raise RuntimeError("Die vorhandene Laufzeit ist unvollstaendig. Bitte Helfer entfernen und neu starten.")
    if shutil.disk_usage(root).free < size * 2.2 + 1024**3:
        raise RuntimeError("Zu wenig freier Plattenplatz fuer Download und entpackte Laufzeit.")
    archive = root / ("runtime-" + sha + ".tar")
    if archive.is_symlink():
        raise RuntimeError("Die Download-Datei ist eine Verknuepfung.")
    print("Vorhandene Laufzeit pruefen; Strg+C bricht ab ...")
    if not (archive.is_file() and archive.stat().st_size == size and digest_file(archive) == sha):
        partial = archive.with_suffix(".partial")
        if partial.is_symlink():
            raise RuntimeError("Die Teildatei ist eine Verknuepfung.")
        key = config["bootstrap"]
        session = root / "state/session.json"
        if session.is_file():
            saved = json.loads(session.read_text())
            if saved.get("endpoint") == config["endpoint"] and saved.get("certificate_sha256") == config.get("certificate_sha256"):
                key = saved.get("session") or key
        download(config, partial, key)
        print("Download vollstaendig. SHA-256 wird geprueft ...")
        if digest_file(partial) != sha:
            partial.unlink()
            raise RuntimeError("Die Laufzeit-Pruefsumme stimmt nicht. Der beschaedigte Download wurde entfernt.")
        partial.replace(archive)
    staging = root / (".install-" + sha)
    if staging.exists():
        if staging.is_symlink():
            raise RuntimeError("Ungueltiger Installationsordner.")
        shutil.rmtree(staging)
    print("Laufzeit entpacken ... Strg+C bricht ab; keine Systemdateien werden veraendert.")
    try:
        unpack(archive, staging)
        (staging / ".bts-complete").write_text(sha)
        staging.rename(runtime)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return runtime


def sandbox_command(runtime, state):
    command = ["bwrap", "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--new-session",
               "--ro-bind", str(runtime), "/", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
               "--tmpfs", "/etc", "--bind", str(state), "/var/lib/bts-speech-helper", "--chdir", "/"]
    # WSL creates its DNS files itself; the shared archive has no mount targets
    # for them. A private /etc permits these mounts without writing to rootfs.
    for name in ("passwd", "group", "nsswitch.conf", "os-release"):
        source = runtime / "etc" / name
        if source.is_file():
            command += ["--ro-bind", str(source), "/etc/" + name]
    for name in ("resolv.conf", "hosts"):
        source = Path("/etc") / name
        if source.is_file():
            command += ["--ro-bind", str(source.resolve()), "/etc/" + name]
    return command + ["--", "/usr/bin/python3", "/opt/bts-speech-helper/agent.py", "--config-stdin", "--watch-stdin"]


def run(config, root, threads, memory):
    prerequisites()
    if memory_info()[1] < memory + 512:
        raise RuntimeError("Zu wenig freier Speicher fuer das Modellbudget plus 512 MiB Reserve.")
    if root.exists():
        marker(root, config)
    with installation_lock(root, True):
        marker(root, config, True)
        runtime = prepare(config, root)
        state = root / "state"
        if state.is_symlink():
            raise RuntimeError("Der Sitzungsordner ist eine Verknuepfung.")
        state.mkdir(mode=0o700, exist_ok=True)
        if (root / "settings.json").is_symlink() or (root / "device-id.txt").is_symlink():
            raise RuntimeError("Eine eigene Einstellungsdatei ist eine Verknuepfung.")
        (root / "settings.json").write_text(json.dumps({"threads": threads, "memory_limit_mib": memory}))
        values = dict(config, threads=threads, memory_limit_mib=memory, name=platform.node(), platform="Linux / Bubblewrap")
        device = root / "device-id.txt"
        if not device.exists():
            device.write_text(str(uuid.uuid4()))
        values["device_id"] = device.read_text().strip()
        print("Mit BTS verbinden. Fenster offen lassen; Strg+C beendet den Helfer.", flush=True)
        process = subprocess.Popen(sandbox_command(runtime, state), stdin=subprocess.PIPE, text=True,
                                   env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}, start_new_session=True)
        try:
            process.stdin.write(json.dumps(values) + "\n")
            process.stdin.flush()
            process.wait()
        finally:
            if process.poll() is None:
                print("\nStoppen angefordert; laufende Aufnahme wird abgebrochen ...", flush=True)
                try:
                    process.stdin.write("stop\n")
                    process.stdin.flush()
                except (BrokenPipeError, OSError):
                    pass
                try:
                    process.wait(timeout=40)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            process.stdin.close()
        if process.returncode:
            raise RuntimeError("Der Helfer wurde mit Fehler beendet. Bitte die Meldung oben pruefen.")


def main(config, arguments=None):
    if sys.version_info < (3, 8):
        raise RuntimeError("Bitte Python 3.8 oder neuer mit dem System-Paketmanager installieren.")
    config_check(config)
    parser = argparse.ArgumentParser(description="Freiwilliger BTS-CPU-Sprachhelfer: starten, Ressourcen waehlen, stoppen und entfernen.")
    parser.add_argument("--info", action="store_true", help="Nur Hinweise anzeigen, nichts installieren oder verbinden")
    parser.add_argument("--remove", action="store_true", help="Eigene Installation nach Bestaetigung entfernen")
    args = parser.parse_args(arguments)
    root = own_root(config)
    threads, memory, advice = min(2, cpu_count()), 3584, None
    try:
        saved = json.loads((root / "settings.json").read_text())
        threads = max(1, min(16, cpu_count(), int(saved["threads"])))
        memory = max(2560, min(16384, int(saved["memory_limit_mib"])))
    except (FileNotFoundError, ValueError, KeyError, TypeError):
        pass
    plan(config, root, threads, memory)
    if args.info:
        return
    if not sys.stdin.isatty():
        raise RuntimeError("Bitte in einem Terminal starten: bash BTS-Sprachhelfer-Linux.sh. --info zeigt nur Hinweise.")
    if args.remove:
        remove(root, config)
        return
    while True:
        print("\n1 Starten  2 Ressourcen waehlen  3 Last messen  4 Vorschlag uebernehmen  5 Helfer entfernen  0 Beenden")
        print("Aktuelle Wahl: %s CPU-Kerne, %s MiB Modell-RAM." % (threads, memory))
        try:
            choice = input("Auswahl: ").strip()
            if choice == "0":
                return
            if choice == "1":
                run(config, root, threads, memory)
            elif choice == "2":
                requested_threads = int(input("CPU-Kerne (1-%s): " % min(16, cpu_count())))
                requested_memory = int(input("Modell-RAM-Abbruchgrenze in MiB (2560-16384): "))
                if not 1 <= requested_threads <= min(16, cpu_count()) or not 2560 <= requested_memory <= 16384:
                    raise ValueError("Ressourcenwahl liegt ausserhalb des erlaubten Bereichs.")
                threads, memory = requested_threads, requested_memory
            elif choice == "3":
                advice = recommend()
            elif choice == "4":
                if not advice or time.monotonic() - advice[2] >= 60:
                    print("Kein aktueller Vorschlag. Bitte neu messen oder Werte selbst waehlen.")
                else:
                    threads, memory = advice[:2]
                    print("Vorschlag uebernommen. Erst Starten verwendet diese Wahl.")
            elif choice == "5":
                remove(root, config)
        except KeyboardInterrupt:
            print("\nVorgang gestoppt. Teildownloads und vorhandene Modelle bleiben erhalten.")
        except (OSError, RuntimeError, ValueError, tarfile.TarError, http.client.HTTPException, subprocess.TimeoutExpired) as error:
            print("Fehler:", error)


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main(BTS_BUNDLE_CONFIG, sys.argv[2:])
    except (KeyboardInterrupt, EOFError):
        print("\nHelfer beendet.")
    except Exception as error:
        print("Sprachhelfer konnte nicht starten:", error, file=sys.stderr)
        sys.exit(1)
