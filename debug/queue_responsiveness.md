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
