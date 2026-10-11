# Blockieren BTP-Syncs die Spielaufrufe?

Der Vergleich startet alte und aktuelle BTS-Module in eigenen Prozessen mit
jeweils frischen, synthetischen Daten: 519 aufrufbare Spiele, 1.038 Spieler und
13 Felder. Er braucht keinen laufenden BTS-Server. Daten und Prozesse des
laufenden Turniers werden nicht angefasst. Diese Messung bleibt im BTS-Repo,
weil sie interne Servermodule untersucht; der allgemeine Testclient liegt
weiterhin im separaten Repository.

Aus dem BTS-Verzeichnis starten:

```sh
npm run debug:queue-check
```

Standardmäßig werden `cf73f0a731dd26aac4fb360a71b5d2b165deef0f` und `HEAD`
verglichen. Es gibt drei Wiederholungen pro Stand und Szenario, mit wechselnder
Reihenfolge. Der Runner schreibt den Fortschritt und das Ergebnisverzeichnis
unter `/tmp/bts-queue-responsiveness-*` auf die Konsole. Ein Durchlauf dauert
typischerweise wenige Minuten. `Ctrl+C` beendet ausschließlich seine eigenen
Kindprozesse. Es sind keine neuen zehnminütigen Turnierläufe notwendig.

| Szenario | Sync | Zeitpunkt des Spielaufrufs |
| --- | --- | --- |
| `idle` | Kein Sync, Kontrolle | Sobald der Empfangsclient verbunden ist |
| `slow-fetch` | BTP-Antwort wird 2 Sekunden verzögert; keine Integration | Beim Absenden der BTP-Anfrage |
| `changed-sync` | Nummern von 518 Spielen ändern; Spiel 1 bleibt unverändert | Beim ersten tatsächlichen Schreibvorgang an der Match-DB |
| `unchanged-sync` | Identischer BTP-Datenstand | Unmittelbar vor der Antwortverarbeitung |

Jeder Fall ruft Spiel 1 tatsächlich auf Feld 1 auf und fordert zusätzlich eine
freie Durchsage an. Ein separater Prozess misst die Ankunft der zugehörigen
WebSocket-Events vor dem JSON-Parse. Er erwartet außerdem beide Antworten.
Die alte FIFO-Queue hält den gesamten Fetch einschließlich Transport und Sync;
beim aktuellen Stand liegen Transport und Planung vor dem Integrations-Lock.

`report.json` enthält die aufgelösten Commit-IDs, den Fixture-Fingerprint,
Einzelmessungen und Zusammenfassungen. Jeder Fall liefert zusätzlich
`server-result.json` mit Queue- und DB-Aufgaben, Warte-/Laufzeiten, 20-ms-Samples
und Event-Loop-Verzögerung. Die aktuellen Scheduler-Blocker werden beim
Taskstart übernommen, einschließlich der konkret kollidierenden Locks.
Das beschreibt den zuletzt beobachteten Konflikt, keine exakte Aufteilung
der gesamten Wartezeit zwischen allen möglichen Blockern.

Die Messpunkte helfen, Verzögerungen auseinanderzuhalten:

1. Client sendet die Anfrage.
2. Der Admin-Handler beginnt (`call_dispatch_ms`: Empfang/Verarbeitung davor).
3. Die Aufgabe wird eingereiht (`call_queue_admission_ms`: unter anderem DB-Lesen davor).
4. Die Aufgabe beginnt (`call_queue_wait_ms`: Warten im Scheduler).
5. Das Aufruf-Event kommt beim Client an (`call_ms`: gesamte Empfangslatenz).
6. Der Root-Sync endet; anschließend müssen Scheduler und DB-Queues leer werden.

Die Überlappungsflags zeigen separat, ob Senden und Queue-Eintritt tatsächlich
vor dem Sync-Ende lagen. Ein schneller Sync kann bereits vor dem eintreffenden
Probe-Request enden; dieser Fall darf nicht als Beweis für parallele Integration
interpretiert werden. Die Kontrolle ohne Sync hat keine Überlappungsaussage.
Der Runner prüft alle 518 Änderungen und das vollständige Leeren der Queues.

Einzelne Szenarien lassen sich wiederholen, beispielsweise:

```sh
npm run debug:queue-check -- --refs HEAD --phases changed-sync --samples 3
```

Den Plan ohne Testserver ansehen:

```sh
npm run debug:queue-check -- --dry-run
```

Grenzen: Der kontrollierte BTP-Callback ersetzt Netzwerk und XML-Decodierung;
Parser, Sync, persistente NeDB, Admin-Handler und WebSocket-Versand laufen real.
Normale Automatisierungstimer werden nicht gestartet; die tatsächlich vom Fetch
ausgelösten Folgeaufgaben bleiben erhalten. Eine freie Durchsage umgeht schon
im alten Stand die globale Queue und dient als Gegenkontrolle. Gemessen wird
das Signal am Client, weder Audio-Start noch Browser-Rendering. Event-Loop-Maxima
umfassen auch die Verarbeitung des Spielaufrufs und seine Folgeaufgaben, nicht
nur den Sync. Drei Wiederholungen zeigen keine belastbare Langzeit-p95; bei
drei Werten ist die ausgegebene p95 schlicht deren Maximum.

Die Server laufen mit ihren Standardeinstellungen; geerbte `BTS_*`-Variablen
werden entfernt. Insbesondere sind gebündelte Sync-Writes im verglichenen
aktuellen Stand standardmäßig ausgeschaltet. Die eingesetzten Dependencies
stammen für beide Stände aus demselben installierten `node_modules`; dies ist
ein kontrollierter Codevergleich, keine historische Dependency-Rekonstruktion.
Der Runner archiviert seine eigene Messimplementierung, deren Hashes und den
Hash des Dependency-Lockfiles zur Nachvollziehbarkeit. Die synthetischen
Messberichte können ohne reale Spielernamen oder BTP-Zugangsdaten weitergegeben
werden.

## Fortlaufende Punkte, Nummernänderungen und Aufrufe

Der zusätzliche Dauertest benutzt dieselbe isolierte, synthetische Turnierbasis
und den Testmotor aus dem separaten `bts-testclient`-Repository. Er benötigt
keinen laufenden Server. Standard: zwei Minuten; drei Minuten einschließlich
echter Spielenden lassen sich so ausführen:

```sh
npm run debug:mixed-queue -- --duration-ms 180000
```

Es laufen 13 Felder mit Punkten alle 800–1600 ms, Admin-Übersichten und
Diagnoseabfragen. Alle zwei Sekunden ändern sich die Nummern noch nicht
begonnener Spiele; freie Durchsagen werden ebenso häufig angefordert. Ein
unverändertes Spiel wird während der ersten Integration tatsächlich aufgerufen.
Weitere Aufrufe entstehen automatisch aus den Spielenden. Die Gesamtzahl der
Aufruf-Events enthält den ersten manuellen Aufruf; sie wird nicht vollständig
als Anzahl automatischer Aufrufe ausgewiesen.

Der periodische Sync verwendet den echten validierenden Integrationsplaner mit
realen DB-Schreibvorgängen und Benachrichtigungen. Die Nummernänderung wird
direkt im isolierten Planungsstand erzeugt. BTP-Transport und vollständiger
Parser laufen nur beim Aufbau des Turniers. Eine wiederholte alte Komplettantwort
würde laufende Punkte/Ergebnisse zurücksetzen und die Messung verfälschen.
Tabletoperator- und Offiziellenzuweisung sind in dieser Testbasis ausgeschaltet.
Die zunächst nicht eingeplanten BTP-Spiele werden vor Beginn in der isolierten
DB als eingeplant markiert, damit sie nach einem Spielende aufgerufen werden
können. Beobachtet der Lauf Spielenden ohne weitere Aufruf-Events, gilt diese
Prüfung als fehlgeschlagen.

`report.json` dokumentiert Server-/Client-Commit, Messquellen-Hashes,
Empfangsstatistiken und drei Zeitabschnitte. Jeder Abschnitt zeigt wartende
Scheduler- und DB-Aufgaben sowie Zahl/Alter unfertiger Syncs, einschließlich
Serialisierung vor dem ersten Ressourcen-Lock. `sync_stage_start_ms` enthält
diese Wartezeit und den Aufbau des Planungsstands bis zum Beginn der
Integrationsfunktion; es ist keine reine Scheduler-Wartezeit. Die Rohdaten
liegen unter `mixed/server-result.json`, `client-result.json` und
`probe-result.json` im ausgegebenen Verzeichnis. Nach dem Ende der Simulation
stoppt der Runner weitere Syncs und verlangt das vollständige Leeren der
beobachteten Scheduler-/DB-Aufgaben. Fehlende Aufruf-/Durchsage-Events oder
Antworten sowie fehlender TV-/Admin-Punktempfang lassen den Lauf fehlschlagen.
Das gilt auch für Fehler in den abgeholten Verarbeitungs-Traces. Unvollständig
zugeordnete Punkte werden mit Anzahl und Zustellquote ausgewiesen.

Der Fortschritt erscheint alle zehn Sekunden. `Ctrl+C` beendet nur die eigenen
Testprozesse. `--ref` wählt einen archivierten Commit des aktuellen Planers,
`--sync-interval-ms` das Sync-Intervall (500–10000 ms), `--matches` 14–2000
Spiele und `--duration-ms` 5 Sekunden bis 5 Minuten. Der historische FIFO-Stand
hat diesen Planer nicht; dafür weiterhin den kontrollierten Paarvergleich oben
verwenden. Kurze Spitzen und vollständig abgebaute Queues sind kein Beleg für
Stabilität bei beliebig hoher Last oder für den akustischen Start im Browser.

Mit `--point-min-ms` und `--point-max-ms` kann die Punktfrequenz erhöht werden.
Der kürzere geprüfte Lauf mit automatischen Folgeaufrufen verwendet:

```sh
npm run debug:mixed-queue -- --duration-ms 90000 --point-min-ms 400 --point-max-ms 800
```

`--set-points 3` verkürzt ausschließlich die synthetischen Sätze für gezielte
Fehlerreproduktionen; Standard bleibt 21. Solche Läufe sind kein gleichwertiger
Vergleich zur normalen Spielsimulation. `mixed/replans.jsonl` sichert bis zu
256 Gründe für Neuplanungen, einschließlich abweichender Felder, auch wenn
der Test vorzeitig abbricht. Diese zusätzliche Diagnose schreibt nur im
isolierten Testprozess; der normale Server bekommt dadurch keine neuen Logs.
