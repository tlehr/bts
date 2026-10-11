bts - Badminton Tournament Software
==========

Use [bup](https://github.com/phihag/bup/) at tournaments.

## Docker installation

[Install docker](https://docs.docker.com/install/) and run

```
docker run -p 4000:4000 phihag/bts
```

## Manual installation

To install, type

    make

To start, type

	make run  # Production mode
	make dev  # Development mode

The server is quiet during normal operation; actual errors remain visible.
Under tournament settings → Debug, **detailed server diagnostics** enables
sync measurements, slow queue reports, render acknowledgement diagnostics and
tablet operator audit output. The setting takes effect immediately and is saved
with the tournament. Shared queue/database diagnostics appear when enabled for
any tournament. Other existing debug switches remain independent.

`BTS_SERVER_DIAGNOSTICS=1` enables these diagnostics globally;
`BTS_SERVER_DIAGNOSTICS=0` disables the new diagnostics setting globally.
Explicit diagnostic environment variables such as `BTS_BTP_SYNC_TIMING=1`,
`BTS_TABLETOPERATOR_AUDIT=1` or `BTS_SCORE_PRESS_TIMING=1` still enable their own
output. Leave these variables unset to control logging through the admin menu.

## Development checks

Run JavaScript linting with `npm run lint:js` or `make eslint`, and tests with
`npm test`. Linting includes the server, browser code, tests and debug scripts.
The configuration uses ES2022 syntax and Node globals, with Mocha globals for
tests. Tests and debug scripts allow console output; server console calls still
need an explicit exemption.

ESLint is pinned to 8.57.1 for the existing Node 19 runtime and `.eslintrc`
configuration. This is a legacy compatibility choice: ESLint 8 is no longer
maintained. Upgrading to a maintained ESLint version requires a newer Node
runtime and configuration migration; see the
[ESLint prerequisites](https://eslint.org/docs/latest/use/getting-started#prerequisites).
The lint command reports existing rule violations; parser support does not
imply that the entire repository is free of lint errors.

# Usage

To start a display, go to http://IP:4000/d2 , where 2 is the court number (alternatively, just `/d`).
To start an umpire panel, go to http://IP:4000/u2 , where 2 is the court number (alternatively, just `/u`).

## Lokales Testdashboard

BTS wie üblich mit `make dev` oder `make run` starten. Das separate Testwerkzeug
startest du mit `npm run debug:dashboard`; öffne danach
<http://127.0.0.1:4444>. Wähle Server und Turnier und starte den Test dort.
Das Öffnen der Oberfläche startet keine Simulation. Die vorhandenen Konsolen-
und Benchmark-Befehle bleiben verfügbar.

Unter **Ablauf & Warteschlangen** gibt es Ablaufpläne für Punkte, Spielende,
BTP-Sync, Vorbereitung/Aufrufe und das Laden der Admin-Übersicht. Klicke einen
Schritt für letzte Dauer, Mittelwert, p95, Maximum, Fehler und einen Zeitgraphen.
Die Zeitleiste eines einzelnen Vorgangs zeigt ausgeführte Schritte, überlappende
Arbeit, Lock-Warten und Lock-Halten. Beobachtete Blockierer lassen sich öffnen;
ein Konflikt erklärt nicht zwangsläufig die gesamte Wartezeit, die auch Scheduling
enthält. Verschachtelte/parallel ausgeführte Zeiten werden nicht addiert.

**Verarbeitungsschritte und Locks aufzeichnen** ist im Test standardmäßig aktiv.
Es aktiviert zusätzliche Server-Telemetrie über eine alle Sekunde erneuerte
10-Sekunden-Freigabe. Ohne weitere Abfragen läuft diese automatisch aus; sie
schaltet keine Konsolenlogs ein. Für Vergleiche ohne Detailaufzeichnung lässt sich
die Checkbox ausschalten; auf der Konsole gilt `--no-processing-traces`.
Warteschlangenmessungen bleiben verfügbar. p95 der Verarbeitungsschritte basiert
auf den letzten bis zu 256 Ausführungen je Messstelle in der serverweiten
Diagnosesitzung; Punkt-Empfangswerte bleiben davon unabhängig.

**Bericht herunterladen** liefert JSON, auch während des Tests als entsprechend
markierten Zwischenbericht. Er enthält kumulative Empfangs-/Payload-Werte,
Zeitreihen, aufgezeichnete Vorgänge mit Locks, Test-/Diagnoseereignisse und
Einstellungen. Die Live-Graphen zeigen maximal fünf Minuten; der Export bewahrt
bis zu 43.200 Samples, 5.000 Vorgänge/Punktzuordnungen und 10.000 Ereignisse.
Der Server puffert 500 abgeschlossene Vorgänge, maximal 64 gleichzeitig laufende
Vorgangshandler und 160 Schritte pro Vorgang; der Client holt neue Berichte über
einen Cursor ab. Normales Überschreiben des bereits abgeholten Serverpuffers ist
kein Datenverlust. Lücken, ausgelassene Schritte/Locks und Exportlimits werden
explizit ausgewiesen. Ein neuer Test ersetzt den aktuellen Download; vorher
speichern. Ältere Rohlogs unter `/tmp` werden nicht automatisch importiert.

Gemessen wird bis zum WebSocket-Empfang bei den simulierten TV-/Admin-Clients.
Versandschritte im Server messen die Übergabe an WebSocket, keine bestätigte
Netzwerkzustellung. Serverzeiten und Client-Empfangszeiten werden separat geführt,
auch wenn beide Prozesse verschiedene Rechner/Uhren verwenden. Browser-Rendering
und tatsächliche Audioausgabe gehören nicht zu diesen Messungen.

# Helper scripts

- `./fetch-btp.js` - Fetch data from BTP via TPNetwork protocol
- `div/decode.js` - Decode VisualReality hex format

`npm run debug:benchmark-sequence` runs one ten-minute live comparison with
light automatic preparation and staged compaction. Batch sync writes are
temporarily disabled in the default `combined-responsive-single-writes` profile;
the explicit `combined-responsive` profile retains the previous batch configuration.

`npm run debug:isolated-sync` compares individual and batch sync writes using
identical snapshots of the local tournament. It opens only temporary replicas,
checks paired final documents and reloads, and measures concurrent point context/
write/notification work, the real admin tournament request, and manual announcement
notification serialization. It also includes controls without a sync and writes
reports and CPU profiles to `/tmp/bts-isolated-sync-*`. Browser rendering,
network delivery, match allocation and audible speech start are outside this
diagnostic. Source files must remain unchanged during capture and diagnosis.

`npm run debug:isolated-admin` compares full admin reloads with deferred histories
of finished matches, on identical disposable replicas. Both variants use single
sync writes. It measures concurrent point/admin/announcement work with and without
a synthetic sync, verifies paired persisted documents and reloads, and writes
reports to `/tmp/bts-isolated-admin-*`. For an exact replay, pass
`-- --source /tmp/bts-isolated-sync-Xi6nEx/snapshot`. The admin UI opts into deferred
histories; edit/scoresheet dialogs load a finished history on demand. Active timers
and bulk scoresheet exports retain full histories. Reload an already open admin
page to load the new client script.
