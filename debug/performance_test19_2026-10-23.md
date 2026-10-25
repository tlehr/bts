# Test 19: Kürzere Spitzen und Warten auf Leseaufträge

Test 19 zeigt niedrigere Empfangslatenzen als Test 17. Das Ziel p99 unter 30 ms
wird weiterhin verfehlt. Der Bericht bestätigt kurze Sprach-Sammel- und
Sendeschritte und enthält erstmals die separate Messung des synchronen Starts
der Vorbereitungsauskunft. Eine Erweiterung der geordneten Punktabfragen
vermeidet zusätzliches Warten hinter ausschließlich reinen Leseaufträgen.
Ein Gewinn bei der gesamten Live-Latenz durch diese neue Erweiterung ist noch
nicht nachgewiesen.

## Gelieferter Lauf

`bts-test-19.json`: Beginn 23.10.2026, 19:47:05 UTC; Laufzeit 322.232 ms,
`stop_reason: interrupted`, kein gemeldeter Testfehler. Anfangs 373 Spiele,
77 beendet und 13 aktiv. Ein Serverlauf; gemeinsame Admin-Codierung,
direkte Punktespeicherung und Modell-Lesepfade sind aktiviert. Die neue
Erweiterung `score_readonly_reads` ist in diesem Bericht noch nicht enthalten.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 10,3 ms | 5 ms | 32 ms | 53 ms | 85 ms | 10 | 762/762 |
| Admin | 13,3 ms | 8 ms | 35 ms | 59 ms | 88 ms | 14 | 762/762 |

In Test 17 lagen p99 und Maximum bei 93/183 ms für TV und 108/195 ms für
Admin. Beide Läufe verwenden 373 Spiele, unterscheiden sich aber in fertigen
Spielen, Laufzeit und tatsächlichen Aktionen. Der Unterschied ist eine
Beobachtung, kein kontrollierter Wirkungsnachweis der Prioritätskorrektur.

Es wurde kein Update über 100 ms gemessen. Der Bericht meldet keine
Rückstau-Vorfälle, Tracearchiv-Lücken oder verworfenen Archiveinträge. Er enthält
321 Telemetrieproben, eine fehlgeschlagene Diagnoseabfrage und 5.601 Traces,
darunter 761 Score-Handler. Die zuletzt gemessenen Lock-, Match- und
Turnier-Queues sind leer. Der Lauf endet noch während der Lastphase, vor der
Ruhephase; Entleerung und anschließende erneute Last sind damit nicht geprüft.

## Untersuchte Verzögerungen

| Aktualisierung | TV / Admin | Vor Handlerbeginn | Lock-Warten | Kontext lesen | Updatephase |
| --- | ---: | ---: | ---: | ---: | ---: |
| 345 | 85 / 88 ms | 3 ms | 74,6 ms | 0,9 ms | 3,2 ms |
| 420 | 70 / 77 ms | 37 ms | 14,5 ms | 11,7 ms | 4,6 ms |
| 687 | 70 / 76 ms | 26 ms | 23,7 ms | 15,4 ms | 3,8 ms |
| 688 | 71 / 75 ms | 17 ms | 10,6 ms | 4,6 ms | 37,3 ms |
| 490 | 65 / 71 ms | 16 ms | 4,9 ms | 29,8 ms | 12 ms |
| 491 | 53 / 55 ms | 3 ms | 0,2 ms | 23 ms | 25,5 ms |

345 wartet auf denselben Match-/Feldbereich wie ein BTP-Commit. Dessen
Lock-Haltezeit beträgt 71,5 ms, die Schreibphase 38 ms. Nach dem Erwerb der
Sperren braucht das Punktupdate nur 3,2 ms bis zum Schreib-Callback.

Bei 490 steht ein Turnier-Snapshot aus einer Vorbereitungsauskunft als
DB-Blocker; die Kontextphase wartet rund 29 ms. Bei 687 stehen ebenfalls
Snapshot-Reader vor den drei Kontextabfragen. Bei 491 steht ein gewöhnlicher
Turnier-Reader vor der Kontextabfrage. Die Traces zeigen den zuletzt beobachteten
Blocker; sie beweisen nicht, dass zu jedem Einreihungszeitpunkt die ganze Queue
ausschließlich aus Lesern bestand. Frühere Writes müssen weiterhin abgewartet
werden. Die neue Erweiterung zieht daher nicht pauschal diese Zeiten ab.

Vor dem Handlerbeginn liegen bei einigen Spitzen zusätzliche Verzögerungen.
Die zugehörigen Punktmeldungen im Testclient entstehen 0–1 ms nach dem erfassten
Sendezeitpunkt. Wo genau die restliche Zeit vor dem Handler verbraucht wurde,
lässt sich damit nicht vollständig aufteilen. Ebenso sind Append- und
Callback-Zeiten keine reinen physischen Plattenzeiten. Überlappende Phasen
dürfen nicht addiert werden.

## Hauptthread und Sprachausgabe

855 tatsächliche Berechnungen enthalten `preparation_selection_sync_start`:
Median 8,1 ms, p95 12,6 ms, p99 19,5 ms, Maximum 28,8 ms. Dieser Span misst
den synchronen Anfang; die anschließend kooperativ ausgeführten Diagnosen
kommen hinzu. Die gesamte Antwortdauer enthält auch absichtliches Warten auf
Punkte und Datenbank-Leseschranken.

Der Sprachprozess läuft, am Ende ohne ausstehende Anfragen. Im Tracearchiv
dauert `speech_snapshot_collect` höchstens 0,9 ms und `speech_bridge_send`
höchstens 4,9 ms. Der kumulative Sendemaximalwert seit dem Start des Servers
liegt bei 7,4 ms. Gemeinsame Admin-Codierungen erreichen höchstens 6,5 ms.
Die höchste Event-Loop-Timermessung beträgt rund 67,2 ms bei 20-ms-Auflösung.
Die Messungen belegen keine alleinige Verursachung der Verzögerungen durch
die Sprachausgabe.

Ein provisorischer vollständiger Worker-Aufruf der Vorbereitungsauskunft wurde
an einer Turnierkopie geprüft. Ohne Revisionsübertragung und Transportoptimierung
kostet bereits das Kopieren der Eingabe in den Worker etwa 7–11 ms im
Hauptthread; die Antworten werden insgesamt langsamer. Dieser Prototyp wurde
nicht in den Server übernommen. Eine weitergehende Auslagerung braucht einen
gezielten Transportentwurf und einen gesonderten Wirkungsnachweis.

## Erweiterung des schnellen Lesepfads

Bisher konnte eine Punktabfrage sofort aus dem Objektmodell lesen, wenn der
Datastore leer war oder eine bestätigte reine Kompaktierung ausführte. Auch
eine Queue mit ausschließlich Lesern führte zum Einreihen und weiteren
Executor-Durchläufen.

Jetzt kann die Abfrage auch bestätigte NeDB- und Modell-Leser passieren.
Die Beobachtung prüft die Identität des laufenden Slots und die Anzahl aller
wartenden Aufträge. Sie behält den Besitzer bis zu NeDBs tatsächlicher
Queue-Freigabe. Der Datastore-Callback allein ist dafür zu früh: NeDB hält den
Slot noch bis zu einem späteren `setImmediate`. Ein unbeobachteter neuer
Auftrag darf dabei nicht mit einem bereits abgeschlossenen Reader verwechselt
werden.

Ein laufender oder vorher eingereihter Write, unbekannte Aufgaben, Reloads,
nicht beobachtete Queue-Einträge und TTL-Indizes verhindern den neuen Pfad.
Auch TTL-Fähigkeit beim Einreihen oder Start eines Readers wird festgehalten.
Die Abfrage erstellt sofort eine isolierte Kopie und liefert ihren Callback
asynchron. Spätere Writes bleiben in ihrer bisherigen Queue-Position.
Punkte werden weiterhin vor TV-/Admin-Veröffentlichung persistiert.

`BTS_SCORE_MODEL_READONLY_READS=0` deaktiviert die Erweiterung. Das Profil nennt
`score_readonly_reads`; erfolgreiche schnelle Kontextabfragen nennen
`model_read_decision: read_only_store`.

## Prüfung und Grenzen

285 Regressionstests bestanden. Zehn neue Fälle prüfen die drei Kontextteile,
native Leser einschließlich ihrer Callback-/Freigabephase, frühere und spätere
Writes, laufende Persistenz, unbekannte und unbeobachtete Aufträge, TTL-Änderungen
und den abgeschalteten Pfad. Die vorhandenen Prüfungen decken unter anderem
BTP-Abgleiche, gleichzeitige Punktmeldungen, Kompaktierung, Speicherung und
erneutes Laden, Versandreihenfolge und Sprachprozess ab. ESLint der geänderten
Module und neuen Tests sowie `git diff --check` bestanden.

Ein isolierter Vergleich verwendet eine unveränderte Kopie mit 373 Spielen und
13 aktiven Spielen. Je Versuch werden sechs echte Vorbereitungsauskunft-Abfragen
gestartet. Nachdem ihre 36 Modell-Leseaufträge eingereiht sind, startet eine
Punktmeldung über den echten BUP-Handler. Der Vergleich schaltet nur das neue
Feature aus beziehungsweise ein; die neue Queue-Beobachtung gilt für beide
Varianten. Zwölf Paare laufen mit wechselnder Reihenfolge im selben Prozess.

| Messung, je 12 Proben | Pfad aus | Pfad an |
| --- | ---: | ---: |
| Median größtes Kontext-Queue-Warten je Punkt | 3,05 ms | 0,1 ms |
| Höchstes Kontext-Queue-Warten | 9 ms | 0,3 ms |
| Median bis TV-Mock | 16,91 ms | 19,52 ms |
| Median bis Admin-Mock | 17,23 ms | 19,97 ms |

Alle 36 Kontextteile verwenden mit dem Feature den schnellen Pfad; mit
abgeschaltetem Feature keinen. Die vollständigen Datenbankzustände stimmen
in allen zwölf Paaren überein, auch nach erneutem Laden der Dateien.

Der gezielte Leseabschnitt wird kürzer. Ein allgemeiner Gewinn bei der gesamten
Punktelatenz ist in diesen Proben nicht belegt; deren Median ist etwas höher.
Die Gesamtlatenzen schwanken auch in zwei zusätzlichen getrennten Prozesspaaren.
Kaltstarts sind enthalten; der erste Versuch der Serie ist erheblich langsamer.
Maxima aus diesen wenigen Proben sind deshalb kein stabiler Vergleich.
Netzwerkempfang, Browserdarstellung, echte BTP-Verbindungen und Sprachsynthese
sind nicht enthalten. Der Benchmark schreibt nur in temporäre Kopien und sendet
keine Punkte an das laufende Turnier oder BTP.

Die [anonymisierten Daten](performance_test19_2026-10-23.json) enthalten die
Live-Kennzahlen und die isolierten Vergleichsproben. Ein BTS-Neustart lädt den
neuen Pfad. Seine Wirkung auf p99 muss ein neuer vollständiger Lauf einschließlich
Ruhephase und erneuter Last zeigen.
