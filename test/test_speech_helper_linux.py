"""Linux starter tests use private files/HTTPS and a disposable child, never BTP."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "static/speech-helper/Linux.py"
spec = importlib.util.spec_from_file_location("helper_linux", SOURCE)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class LinuxStarterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bts-linux-starter-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "own"
        self.config = {"protocol": 1, "endpoint": "https://bts.example:4434", "certificate_sha256": "a" * 64,
                       "bootstrap": "fixture-only-key", "runtime": {"id": "a" * 64, "sha256": "b" * 64, "size_bytes": 8192}}

    def test_information_only_does_not_create_installation(self):
        with patch.dict(os.environ, {"XDG_DATA_HOME": str(self.directory / "data")}), patch("sys.stdout", io.StringIO()) as output:
            helper.main(self.config, ["--info"])
        self.assertIn("Strg+C", output.getvalue())
        self.assertNotIn("fixture-only-key", output.getvalue())
        self.assertFalse((self.directory / "data").exists())

    def test_unknown_directory_and_link_are_not_removed(self):
        self.root.mkdir()
        keep = self.root / "keep.txt"
        keep.write_text("keep")
        with self.assertRaises(RuntimeError):
            helper.remove(self.root, self.config)
        self.assertEqual(list(self.root.iterdir()), [keep])
        link = self.directory / "linked"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            helper.remove(link, self.config)
        self.assertTrue(keep.exists())

    def test_scoped_removal_leaves_foreign_link_target_and_decline_changes_nothing(self):
        self.root.mkdir()
        helper.marker(self.root, self.config, True)
        foreign = self.directory / "foreign"
        foreign.mkdir()
        (foreign / "keep.txt").write_text("keep")
        (self.root / "link").symlink_to(foreign, target_is_directory=True)
        with patch.object(helper, "confirm", return_value=False):
            helper.remove(self.root, self.config)
        self.assertTrue(self.root.exists())
        with patch.object(helper, "confirm", return_value=True):
            helper.remove(self.root, self.config)
        self.assertFalse(self.root.exists())
        self.assertEqual((foreign / "keep.txt").read_text(), "keep")

    def test_second_starter_cannot_modify_active_installation(self):
        with helper.installation_lock(self.root, True):
            with self.assertRaises(RuntimeError):
                with helper.installation_lock(self.root, False):
                    self.fail("Concurrent lock acquired")

    def test_missing_system_package_is_not_installed_without_consent(self):
        def which(name):
            return None if name == "bwrap" else ("/usr/bin/" + name if name in ("sudo", "apt-get") else None)
        with patch.object(helper.shutil, "which", side_effect=which), patch.object(helper, "confirm", return_value=False), \
                patch.object(helper.os, "geteuid", return_value=1000), patch.object(helper.platform, "machine", return_value="x86_64"), \
                patch.object(helper.subprocess, "call") as install:
            with self.assertRaises(RuntimeError):
                helper.prerequisites()
            install.assert_not_called()

    def test_consented_install_uses_only_selected_package_manager(self):
        installed = []

        def which(name):
            if name == "bwrap":
                return "/usr/bin/bwrap" if installed else None
            return "/usr/bin/" + name if name in ("sudo", "apt-get") else None

        def install(command):
            installed.append(command)
            return 0

        with patch.object(helper.shutil, "which", side_effect=which), patch.object(helper, "confirm", return_value=True), \
                patch.object(helper.os, "geteuid", return_value=1000), patch.object(helper.platform, "machine", return_value="x86_64"), \
                patch.object(helper.subprocess, "call", side_effect=install), \
                patch.object(helper.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
            helper.prerequisites()
        self.assertEqual(installed, [["sudo", "apt-get", "install", "--no-install-recommends", "bubblewrap"]])

    def test_blocked_namespace_does_not_relax_system_rules(self):
        with patch.object(helper.shutil, "which", return_value="/usr/bin/bwrap"), \
                patch.object(helper.os, "geteuid", return_value=1000), patch.object(helper.platform, "machine", return_value="x86_64"), \
                patch.object(helper.subprocess, "call") as install, \
                patch.object(helper.subprocess, "run", return_value=SimpleNamespace(returncode=1, stderr="fixture: blocked")):
            with self.assertRaisesRegex(RuntimeError, "keine globalen Schutzregeln"):
                helper.prerequisites()
            install.assert_not_called()

    def make_tar(self, entries):
        filename = self.directory / "runtime.tar"
        with tarfile.open(filename, "w") as archive:
            for name, kind, value in entries:
                info = tarfile.TarInfo(name)
                info.mode = 0o755
                if kind == "file":
                    data = value.encode()
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
                else:
                    info.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                    info.linkname = value
                    archive.addfile(info)
        return filename

    def test_unpack_preserves_only_expected_links_and_executable_modes(self):
        archive = self.make_tar([("usr/bin/python3.12", "file", "python"), ("usr/bin/python3", "symlink", "python3.12")])
        target = self.directory / "rootfs"
        helper.unpack(archive, target)
        self.assertEqual((target / "usr/bin/python3").read_text(), "python")
        self.assertEqual((target / "usr/bin/python3.12").stat().st_mode & 0o777, 0o755)

    def test_unpack_rejects_traversal_and_unexpected_links(self):
        for index, entry in enumerate([("../outside", "file", "bad"), ("/outside", "file", "bad"),
                                       ("etc/link", "symlink", "/home"), ("hard", "hardlink", "../outside")]):
            with self.assertRaises(RuntimeError):
                helper.unpack(self.make_tar([entry]), self.directory / ("rootfs" + str(index)))
        self.assertFalse((self.directory / "outside").exists())

    def test_sandbox_exposes_only_runtime_state_and_dns(self):
        command = helper.sandbox_command(self.directory / "runtime", self.root)
        self.assertIn("--unshare-pid", command)
        self.assertIn("--die-with-parent", command)
        self.assertIn("/etc", command)
        self.assertIn("--watch-stdin", command)
        self.assertNotIn(str(Path.home()), command)
        self.assertNotIn("--dev-bind", command)

    def test_stopping_real_child_sends_local_budget_and_stop(self):
        child = self.directory / "child.py"
        result = self.directory / "result.json"
        child.write_text("import json,sys\nfrom pathlib import Path\nc=json.loads(sys.stdin.readline())\ns=sys.stdin.readline().strip()\nPath(sys.argv[1]).write_text(json.dumps(dict(threads=c['threads'],memory=c['memory_limit_mib'],stop=s)))\n")
        timer = threading.Timer(.4, lambda: os.kill(os.getpid(), signal.SIGINT))
        with patch.object(helper, "prerequisites"), patch.object(helper, "memory_info", return_value=(32000, 24000)), \
                patch.object(helper, "prepare", return_value=self.directory / "runtime"), \
                patch.object(helper, "sandbox_command", return_value=[sys.executable, str(child), str(result)]):
            timer.start()
            try:
                with self.assertRaises(KeyboardInterrupt):
                    helper.run(self.config, self.root, 1, 3072)
            finally:
                timer.cancel()
        self.assertEqual(json.loads(result.read_text()), {"threads": 1, "memory": 3072, "stop": "stop"})
        self.assertTrue((self.root / "device-id.txt").read_text())

    def test_https_pin_precedes_credentials_and_download_resumes(self):
        cert, key = self.directory / "tls.crt", self.directory / "tls.key"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert),
                        "-days", "1", "-subj", "/CN=localhost"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        body, requests = bytes([42]) * 8192, []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                requests.append(dict(self.headers))
                if self.headers.get("Authorization") != "Bearer fixture-only-key":
                    self.send_error(401)
                    return
                start = int(self.headers.get("Range", "bytes=0-").split("=")[1].split("-")[0])
                self.send_response(206 if start else 200)
                self.send_header("Content-Length", str(len(body) - start))
                if start:
                    self.send_header("Content-Range", "bytes %s-%s/%s" % (start, len(body) - 1, len(body)))
                self.end_headers()
                self.wfile.write(body[start:])

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
        thread.start()
        config = dict(self.config, endpoint="https://127.0.0.1:%s" % server.server_port)
        target = self.directory / "runtime.partial"
        try:
            with self.assertRaises(RuntimeError):
                helper.download(config, target, "fixture-only-key")
            self.assertEqual(requests, [], "Bad certificate received credentials")
            config["certificate_sha256"] = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
            target.write_bytes(body[:1024])
            helper.download(config, target, "fixture-only-key")
            self.assertEqual(target.read_bytes(), body)
            self.assertEqual(requests[0]["Range"], "bytes=1024-")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
