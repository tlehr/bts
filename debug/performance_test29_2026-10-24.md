# Test 29: Mehr Wartezeit im Spielstandpfad

Test 29 läuft am 24.10.2026 von 19:14:59 bis 19:24:59 Uhr in Berlin,
600.105 ms, ohne Testabbruch durch. Alle 1.208 Spielstandmeldungen erreichen
TV und Admin. Die Verzögerungen sind gegenüber Test 28 deutlich höher.

| Empfang | Test | Mittel | p50 | p95 | p99 | Maximum | Über 50 / 100 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 28 | 8,0 ms | 5 ms | 24 ms | 41 ms | 75 ms | 4 / 0 |
| TV | 29 | 19,4 ms | 12 ms | 57 ms | 85 ms | 156 ms | 84 / 6 |
| Admin | 28 | 10,7 ms | 7 ms | 28 ms | 43 ms | 76 ms | 6 / 0 |
| Admin | 29 | 24,1 ms | 18 ms | 62 ms | 95 ms | 159 ms | 121 / 9 |

Das p99-Ziel unter 30 ms wird verfehlt. Es geht keine zugeordnete
Spielstandmeldung verloren. Der Lauf enthält 1.194 Punkte und 32 Spieler-Check-ins.
Anfangs sind 373 Spiele vorhanden, davon 117 beendet und 13 aktiv. Test 28
begann bei 105 beendeten Spielen und enthielt 1.157 Updates. Gleiche Testart
bedeutet hier keinen identischen Ausgangszustand und keinen kontrollierten
A/B-Vergleich.

## Zeitlicher Verlauf

| Phase | Updates | TV p99 / Maximum | Admin p99 / Maximum |
| --- | ---: | ---: | ---: |
| Anmeldung und Spielbetrieb | 292 | 85 / 94 ms | 100 / 106 ms |
| Last | 602 | 96 / 156 ms | 100 / 159 ms |
| Last nach der Ruhephase | 314 | 62 / 117 ms | 70 / 119 ms |

Nach der Ruhephase liegen die Mittelwerte bei 10,0 ms für TV und 13,0 ms für
Admin; zuvor bei 24,1/29,6 beziehungsweise 22,1/27,2 ms. Die zusätzliche Last
ist also zeitlich unterschiedlich stark. Der Export beweist nicht, wodurch
sie ausgelöst oder später reduziert wird.

596 Telemetrieproben und 9.212 Traces sind vorhanden. Alle 1.208
Empfangsmeldungen lassen sich über ihre Trace-ID einem Servervorgang zuordnen.
Es gibt keine fehlgeschlagene Probeabfrage, keine Trace-Archivlücke und keine
verworfenen Archiveinträge. Die Rückstauerkennung meldet keinen anhaltenden
Rückstau; die Entleerung in der Pause dauert 526 ms. Kurze Wartespitzen bleiben
trotzdem sichtbar.

## Konkrete Warteketten

Die größte Spitze liegt 201.554 ms nach Testbeginn: TV 156 ms, Admin 159 ms,
Server-Trace 3447. Der Punkt wartet 87,0 ms auf `matches:score_context_match`.
Als Vorgänger ist eine Anzeigeabfrage `matches:display_context_match`
eingetragen. Diese Abfrage aus Trace 3445 war ihrerseits hinter einem
Spielstand-Schreibvorgang eingereiht. Der anschließende Schreibvorgang von
Trace 3447 wartet weitere 36,7 ms hinter einem anderen Spielstand-Update.
Die eigentliche Kontextkopie braucht nur 0,3 ms. Das ist eine Warteschlange,
kein 87-ms-Lesealgorithmus.

Keiner dieser eingetragenen Vorgänger ist ein Sprachauftrag. Der aktive
Sprachprozess erhält Daten über `speech/snapshot.js`, das weder NeDB-Abfragen
einreiht noch Turnier-/Matchlocks anfordert. Die Bezeichnung DB-Wartezeit
beweist somit keine Turnierdatenbanksperre durch die Sprachgenerierung.
Bei asynchronem Datei-I/O muss der Hauptprozess den Abschluss-Callback
ausführen, bevor NeDB den nächsten Auftrag freigibt. Indirekte CPU- oder
Datenträgerkonkurrenz kann auch solche Wartezeiten verlängern.

Ein zusätzlicher isolierter Regressionstest hält sämtliche
Turnier-Datenbankexecutoren an und verbietet neue Enqueue-Versuche. Ein neuer
Sprachplanungssnapshot und eine vollständige Generierung samt eigenem
Audio-Cache-Abschluss gelingen trotzdem. Damit ist die funktionale Trennung
des aktiven Prozesspfads geprüft, nicht die Ursache der konkreten Live-Spitze.

Beim zweiten großen Bündel um 132 Sekunden dauert das Warten auf die
Speicherung eines Updates 35,6 ms. Nach der Ruhephase wartet Trace 8314
28,7 ms vor einem Schreibvorgang hinter `matches:sync_snapshot_matches` und
anschließend 18,6 ms auf die Speicherung. Warten auf Sperren und Anzeige- oder
Abgleichabfragen kommt zur Zeit des eigentlichen Updates hinzu.

Über die erhaltenen detaillierten Traces steigt p99 der
`matches:score_update_write`-Ausführung von 18,2 auf 38,4 ms. Der
Kontextladepfad steigt von 1,5 auf 19,6 ms. Bei 69 statt zuvor zwei Punkten
benötigt die Match-Kontextabfrage einen Platz in der Datenbankwarteschlange.
Die bestehenden Lesebarrieren schützen vor noch nicht bestätigten Schreibvorgängen;
sie sollten nicht allein für bessere Messwerte umgangen werden.

Anzeige-Nacharbeiten und Geräteinformationen bleiben weitere Ansatzpunkte.
`score_change_court_panels` liegt bei p99 44,4 statt 19,2 ms,
`device_info` bei 61,5 statt 33,5 ms. Teile davon liegen erst nach dem Versand
des aktuellen Spielstands. Die Werte erklären daher nicht automatisch die
Empfangslatenz dieses Punktes, können aber folgende Arbeit verzögern.
Asynchrone Spans überlappen und können länger als ihr ursprünglicher Handler
laufen; ihre Zeiten sind weder addierbare CPU-Zeiten noch unabhängige Ursachen.

## Speicherbereinigung und Sprache

In den ersten sechs Minuten beansprucht die Speicherbereinigung des
BTS-Hauptprozesses 7,29 statt 3,27 Sekunden. Nach der Pause liegen ihre
120-Sekunden-Summen näher beieinander: 1,37 statt 1,22 Sekunden. Die größte
gemessene Event-Loop-Verzögerung in der Lastphase steigt von 63,8 auf 104,4 ms.
Speicherbereinigung trägt zur allgemeinen Verzögerung bei; während der
größten einzelnen Punktspitze ist kein GC-Ereignis verzeichnet. Sie erklärt
diese Spitze somit nicht allein.

Die Audioverwaltung läuft laut Export bereits als separater Prozess.
Laut Rückmeldung des Nutzers generierte die Sprachvorbereitung während
dieses Laufs noch. Die zeitliche Überschneidung ist damit bestätigt; eine
Verursachung der Latenzen oder ihr Anteil ist damit noch nicht gemessen.

| Gemessener BTS-Schritt | Test 28 p99 / Maximum | Test 29 p99 / Maximum |
| --- | ---: | ---: |
| Sprach-Snapshot sammeln | 0,6 / 3,3 ms | 2,8 / 3,3 ms |
| IPC an Audioverwaltung senden | 0,5 / 9,9 ms | 2,8 / 11,1 ms |
| Ein Berechnungspaket der Spielvorbereitung | 5,3 / 19,0 ms | 8,9 / 24,9 ms |

Die kurzen Sprachübergaben sind kein belegter Hauptgrund für die großen
Punktspitzen. Der Bericht enthält jedoch keine zeitliche CPU-Messung der
eigentlichen TTS-Synthese und keine Zuordnung ihrer Generierungsaufträge zu
diesen Spitzen. Indirekte Konkurrenz um Prozessorzeit oder Datenträger bleibt
damit offen. Ebenso fehlen Browserprotokolle zum verwendeten Audioanbieter
oder Browser-Fallback. Aus diesem Benchmark lässt sich die Klangqualität oder
das Sprechtempo der neuen Kontextaufnahmen nicht ableiten.

Die lokale Sprachserver-Konfiguration enthält `BTS_TORCH_THREADS=4`;
für `BTS_KITTEN_DECODER_THREADS` ist lokal kein Wert eingetragen, der
Programmstandard ist ebenfalls vier. Die mitgelieferte systemd-Unit setzt
keine eigene CPU-Priorität. Das sind Konfigurationsbefunde und keine im
Benchmark aufgezeichneten Prozessparameter. Eine gezielte Gegenprobe mit
zwei Threads und niedrigerer Prozesspriorität wäre sinnvoll, falls die
Regression bei ruhender Generierung ausbleibt. Hier wurden weder Threads noch
Prioritäten des laufenden Sprachservers geändert.

Der nächste gezielte Optimierungsbereich sind redundante Anzeigeabfragen und
Geräteinformationen rund um die Spielstandverarbeitung. Für einen belastbaren
Nachweis des TTS-Einflusses braucht es zusätzlich denselben Turnierstand mit
derselben Ereignisfolge einmal bei laufender und einmal bei ruhender
Sprachgenerierung sowie eine Messung der jeweiligen Prozesse. Das erfordert
keine weiteren Änderungen an der Reihenfolge oder an den Lesebarrieren.

Die [anonymisierte Detailauswertung](performance_test29_2026-10-24.json)
enthält Phasen, Vergleichswerte, die 15 langsamsten Empfangsmeldungen und die
jeweiligen Warteketten. Für diese Auswertung wurde kein Test gegen den
laufenden Turnierserver gestartet und es wurden keine produktiven Turnier-
oder BTP-Daten verändert. Die zusätzliche Probe verwendet ausschließlich
temporäre Daten und lokale Testserver.
