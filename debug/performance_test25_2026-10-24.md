# Test 25: Server-Audio funktioniert; Vorbereitung in kürzeren Rechenschritten

Der neue Lauf bestätigt erfolgreiche Server-Wiedergabe auch bei der ersten
Durchsage. Das frühere Browser-Fallback tritt in den zugeordneten Sprachlogs
nicht mehr auf. Die Empfangslatenzen sind niedriger als in Test 21; p99 bleibt
über dem Ziel von 30 ms. Die Vorbereitungsauskunft hat weiterhin lange
synchrone Abschnitte. Jetzt wird auch ihre Kandidatenberechnung unterbrochen,
damit dazwischen Punkte gespeichert und veröffentlicht werden können.

## Gemessener Lauf

`bts-test-25.json`: 24.10.2026, 17:08:18 Uhr in Berlin, 120.907 ms Laufzeit,
Szenario `benchmark`, Seed 519. Der Nutzer hat den Lauf beendet; kein gemeldeter
Testfehler. Zu Beginn: 373 Spiele, 87 beendet, 13 aktive Spiele auf 13 Feldern.
297 Punkte, 301 Spielstandmeldungen einschließlich vier Abschlussbestätigungen
und 16 Spieler-Check-ins. Ein Serverlauf mit allen bisherigen Optimierungen.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Über 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 9,5 ms | 5 ms | 29 ms | 57 ms | 71 ms | 5 |
| Admin | 12,2 ms | 7 ms | 35 ms | 63 ms | 84 ms | 6 |

Alle 301 Meldungen sind beiden Empfängertypen zugeordnet; keine liegt über
100 ms. Test 21 lag bei p50 12/15 ms, p99 61/70 ms und maximal 90/106 ms
für TV/Admin. Unterschiedliche Laufdauer, Aktionen und Szenarien erlauben
keinen kontrollierten Wirkungsnachweis einzelner Änderungen.

Es gibt 121 Telemetrieproben, eine fehlgeschlagene Diagnoseabfrage, 2.169
archivierte Traces und keine Archivlücken oder verworfenen Einträge. Die
überschriebenen Server-Ringpuffereinträge wurden zuvor vom Testclient archiviert.
Am Ende sind die Ressourcen-Locks leer. Einzelne Check-ins warten aufeinander
bis rund 271 ms; kein wachsender Rückstau ist im Bericht gemeldet. Eine
vollständige Queue-Abnahme fehlt: Der Test endet direkt nach den ersten zwei
Minuten, vor Ruhephase und erneuter Last. Die höchste Event-Loop-Timermessung
beträgt rund 66 ms bei 20-ms-Auflösung.

Der RSS steigt von rund 305 auf 443 MiB, der belegte JS-Heap von 47,3 auf
137,4 MiB. Das ist eine Beobachtung während aktiver Traceaufzeichnung und
mehrerer Adminabfragen; ohne anschließende Ruhephase und Heap-Untersuchung
belegt sie kein Speicherleck.

## Erste Durchsage und zentrale Logs

Der Bericht enthält sechs `speech_resolve`-Antworten. Alle angeforderten Teile
sind bereits fertig: 9/9, 7/7, 9/9, 7/7, 7/7 und 7/7 Kontextbausteine.
Die Antworten dauern 85,6 / 4,7 / 120,9 / 8,0 / 2,2 / 4,4 ms.
Keine fordert das alte Einzeltextformat an.

Zusätzlich wurden die lokalen Dateien `data/diagnostics/events*.jsonl` nur
gelesen und über die Wiedergabekennung mit dem Testzeitraum abgeglichen.
Diese Informationen sind eine zusätzliche Quelle und nicht Teil des
hochgeladenen Testberichts. Die Clientzeit trennt den tatsächlichen Ablauf
von späterem Eintreffen einer gebündelten Logmeldung.

Die erste Ansage beginnt um 17:08:23,438 und endet um 17:08:38,372 mit
`status: ok`, `provider: server`, `reason: null`. Die fünf weiteren während
des Tests begonnenen Ansagen enden ebenfalls mit Server-Audio; die letzte
endet um 17:10:32,431 nach dem Testende. Eine siebte, bereits während des
Tests ausgelöste Ansage wartet in der Audioqueue und wird danach ebenfalls
mit Server-Audio abgespielt. Für diese sieben Wiedergaben ist kein
Browser-Fallback protokolliert. Daraus folgt keine Aussage über die akustische
Qualität oder weitere, nicht zugeordnete Browserfenster.

Die Hauptprozessschritte zur Sprachausgabe sind kurz: 112
`speech_snapshot_collect`-Abschnitte dauern höchstens 0,3 ms;
1.003 `speech_bridge_send`-Abschnitte höchstens 4,0 ms. Der Sprachdienst läuft
als eigener Prozess. Das widerlegt keine beliebigen CPU-/I/O-Wechselwirkungen,
liefert aber keinen Beleg für eine lange synchrone Sprachberechnung im
Hauptprozess. Der Bericht allein ermöglicht auch keinen isolierten Vergleich
der Kosten des neuen Logsystems.

## Verbleibender Ansatzpunkt und Korrektur

904 Vorbereitungsauskünfte werden abgefragt. Davon berechnen 340 ihren
Kandidatenanfang neu: Median 7,6 ms, p95 11,1 ms, p99 21,8 ms, Maximum
28,9 ms. Die Diagnosen liefen bereits in kleinen Paketen; Kandidaten,
Frontier und Anzeigefenster wurden davor vollständig synchron aufgebaut.

Beim langsamsten Adminempfang, Update 7, liegen 47 ms vor dem Beginn des
Punkt-Handlers. In diesem Zeitfenster läuft ein synchroner
Vorbereitungsabschnitt von 26,3 ms. Update 4 verbringt 41,2 ms bis zum
Schreib-Callback; diese Dauer enthält Queue-, Speicher- und Callbackwarten
und ist keine reine Plattenzeit. Weitere Spitzen überlappen andere Punkte
oder Abgleich-/Leseaufträge. Eine einzige Ursache für alle Spitzen ist nicht
nachgewiesen; überlappende Messabschnitte sind nicht addierbar.

Die UI-Berechnung verwendet jetzt dieselben Regeln in einem schrittweise
ausgeführten Iterator. Gemeinsamer Teilnehmerindex, Feldbedarf, Frontier,
Kandidaten und Anzeigefenster haben Unterbrechungspunkte. Ein Rechenpaket gibt
nach ungefähr 2 ms an die Ereignisschleife ab und wartet vor dem nächsten
Schritt auf laufende Punkte. Ein einzelner Schritt kann länger dauern;
2 ms sind keine harte Obergrenze. Automatische Aufrufe behalten ihre
synchrone Berechnung und ihre bisherigen Auswahlregeln.

`preparation_selection_dispatch` misst künftig nur den Aufrufstart;
`preparation_selection_turn` die tatsächlich ausgeführten Rechenpakete.
Absichtliches Warten auf Punktpriorität wird aus diesen Paketen ausgeschlossen.
Die bisherige `preparation_selection_sync_start`-Messung bleibt für alte
Berichte gültig, wird aber nicht als neuer, scheinbar schnellerer Gesamtwert
weiterverwendet. Geordnete Datenbank-Leseschranken, Kopien, Cache-Invalidierung
und die Pflicht zur Speicherung vor Veröffentlichung bleiben erhalten.

## Isolierter Vergleich und Prüfungen

Verglichen wurden der vor dieser Korrektur gesicherte Quelltext und der neue
Code mit einer festen Kopie des aktuellen Turniers, ohne Verbindung zu BTS,
BTP oder echten Geräten. Nur temporäre Datenbankkopien wurden geöffnet. Beide
Varianten verwenden die bisherigen kooperativen Diagnosen. Je 18 Messpaare,
drei Aufwärmversuche und wechselnde Reihenfolge; alle Ausgaben sind identisch.

| Event-Loop-Abstand je Berechnung | Vorher | Jetzt |
| --- | ---: | ---: |
| Median des jeweils größten Abstands | 6,50 ms | 3,17 ms |
| Größter Abstand | 9,90 ms | 5,78 ms |
| Median gesamte Berechnung | 14,52 ms | 14,55 ms |

Mit eingeschalteten Verarbeitungstraces ergibt ein weiterer Vergleich
6,26 → 3,39 ms im Median des größten Abstands und maximal 10,00 → 6,29 ms.
Die gesamte Berechnung dauert im Median 14,70 → 14,60 ms. Gemessen werden
Abstände eines `setImmediate`-Heartbeats einschließlich Scheduling und GC,
keine reinen CPU-Zeiten. Das belegt kürzere zusammenhängende Arbeit, aber
noch keine bestimmte p99-Latenz mit Netzwerk und Punktlast.

221 Regressionstests für Auswahl, Teilnehmerabhängigkeiten, Prioritätsbesitz,
Aufrufe, Adminantworten, Punkte, Speicherung und BTP-Effekte bestanden. Die zwei
neuen Fälle scheitern mit dem gesicherten vorherigen Code: Er berechnet
Kandidaten trotz aktiver Punktpriorität und arbeitet nach einem neu gestarteten
Punkt weiter. Mit der Korrektur warten beide Fälle korrekt. Ein zusätzlicher
Fall prüft, dass der Besitzer der Punktpriorität seine eigenen Hilfsabfragen
abwarten kann und dabei weiterhin I/O zum Zuge kommt. ESLint der kleinen
geänderten Module und Tests sowie `git diff --check` bestehen. Die 46 vorhandenen
Lintbefunde in `match_automation.js` sind gegenüber dem gesicherten Stand
unverändert.

Die [Messdaten](performance_test25_2026-10-24.json) enthalten keine Spielernamen.
Ein BTS-Neustart lädt die Korrektur. Für ihren Live-Nachweis ist ein vollständiger
Lauf einschließlich Ruhephase und erneuter Last nötig; dieser wurde nicht an
dem laufenden Turnier gestartet.
