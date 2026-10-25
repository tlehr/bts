# Test 30: Wieder auf dem Niveau von Test 28

Test 30 läuft am 24.10.2026 von 20:06:49 bis 20:16:49 Uhr in Berlin,
600.060 ms, ohne Testabbruch durch. Alle 1.213 Spielstandmeldungen kommen
bei TV und Admin an. Die deutliche Verlangsamung aus Test 29 setzt sich
hier nicht fort; die Messwerte liegen wieder nahe Test 28.

| Empfang | Test | Mittel | p50 | p95 | p99 | Maximum | Über 50 / 100 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 28 | 8,0 ms | 5 ms | 24 ms | 41 ms | 75 ms | 4 / 0 |
| TV | 29 | 19,4 ms | 12 ms | 57 ms | 85 ms | 156 ms | 84 / 6 |
| TV | 30 | 7,7 ms | 5 ms | 21 ms | 36 ms | 75 ms | 4 / 0 |
| Admin | 28 | 10,7 ms | 7 ms | 28 ms | 43 ms | 76 ms | 6 / 0 |
| Admin | 29 | 24,1 ms | 18 ms | 62 ms | 95 ms | 159 ms | 121 / 9 |
| Admin | 30 | 10,2 ms | 7 ms | 24 ms | 40 ms | 80 ms | 6 / 0 |

Das p99-Ziel **unter 30 ms** bleibt verfehlt. Kein Update überschreitet
100 ms. Gegenüber Test 29 sinkt p99 bei beiden Empfängern um rund 58 Prozent.

## Vergleichbarkeit und Datenqualität

Test 30 nennt denselben BTS-Hauptprozess und dieselben Featureflags wie
Test 29. Innerhalb des Laufs ist kein Profilwechsel verzeichnet. Anfangs
sind 373 Spiele vorhanden, davon 130 beendet und 13 aktiv; Test 29 begann
bei 117 beendeten Spielen. Der Lauf enthält 1.197 Punkte und 24 Spieler-Check-ins.
Die Ereignisfolge und der Turnierstand sind verschieden. Das ist daher
kein kontrollierter A/B-Vergleich des Einflusses der Sprachgenerierung.

598 Telemetrieproben und 10.143 Traces liegen vor. Alle 1.213
Empfangsmeldungen lassen sich über ihre Trace-ID einem Servervorgang
zuordnen. Es gibt keine fehlgeschlagene Probeabfrage, keine Trace-Archivlücke
und keine verworfenen Archiveinträge. Eine Telemetrieprobe enthält keine
Event-Loop-Messung. Die Rückstauerkennung meldet keinen anhaltenden Rückstau;
die Entleerung in der Pause dauert 893 ms.

## Phasen

| Phase | Updates | TV p99 / Maximum | Admin p99 / Maximum |
| --- | ---: | ---: | ---: |
| Anmeldung und Spielbetrieb | 307 | 46 / 75 ms | 50 / 80 ms |
| Last | 595 | 37 / 57 ms | 42 / 63 ms |
| Last nach der Ruhephase | 311 | 30 / 36 ms | 33 / 39 ms |

Auch nach der Pause ist das strikte Ziel unter 30 ms noch nicht erreicht.
Die hohe Last aus den ersten sechs Minuten von Test 29 ist hier jedoch
deutlich geringer: Die Speicherbereinigung im BTS-Hauptprozess beansprucht
3,33 statt 7,29 Sekunden; Test 28 lag bei 3,27 Sekunden.

## Datenbank und Übergaben

| Gemessener Abschnitt, p99 | Test 28 | Test 29 | Test 30 |
| --- | ---: | ---: | ---: |
| Spielstand-Kontext laden | 1,5 ms | 19,6 ms | 2,0 ms |
| Spielstand-Schreibauftrag ausführen | 18,2 ms | 38,4 ms | 19,2 ms |
| Auf Spielstand-Ressourcensperren warten | 10,6 ms | 22,9 ms | 8,9 ms |
| Anzeige-Nacharbeiten je Feld | 19,2 ms | 44,4 ms | 18,8 ms |
| Geräteinformationen verarbeiten | 33,5 ms | 61,5 ms | 38,5 ms |
| Sprach-Snapshot sammeln | 0,6 ms | 2,8 ms | 0,5 ms |
| IPC an Audioverwaltung senden | 0,5 ms | 2,8 ms | 0,4 ms |

Die Match-Kontextabfrage wird zehnmal in die Datenbankwarteschlange
eingereiht, gegenüber 69 Fällen in Test 29. Ihr längstes Warten sinkt von
87,0 auf 11,7 ms. Die übrigen Kontexte können überwiegend ohne solchen
Queue-Platz aus dem Modell gelesen werden.

Es werden sogar mehr Sprach-Snapshot-/IPC-Spans aufgezeichnet als in
Test 29: 367 statt 299 Snapshots und 5.068 statt 4.219 Sendeschritte.
Das spricht gegen die bloße Anzahl dieser Übergaben als Erklärung der
Verlangsamung in Test 29. Die Dauer der eigentlichen TTS-Synthese und deren
CPU-Last werden dadurch nicht gemessen. Die bereits geprüfte Trennung der
Turnierdatenbank von der Sprachgenerierung bleibt davon unberührt.

Die Zeiten der asynchronen Abschnitte überlappen; sie dürfen nicht addiert
oder insgesamt als reine CPU-Zeit interpretiert werden. Anzeige- und
Gerätenacharbeiten laufen teilweise erst nach der aktuellen Punktmeldung.

## Größter verbliebener Ausreißer

Der höchste Empfangswert liegt 82.537 ms nach Testbeginn: TV 75 ms,
Admin 80 ms, Server-Trace 10841. Zwischen dem Versandstempel des Testclients
und dem Beginn dieses Servertraces liegen 53 ms. Das erfasst Transport und
Eingangsverarbeitung vor dem beobachteten Handler; der Export löst diesen
Abschnitt nicht weiter auf. Der Vergleich der Zeitstempel setzt vergleichbare
Client- und Serveruhren voraus.

Im Handler liegt keine nennenswerte Ressourcensperrwartezeit vor. Der
Schreibvorgang enthält 19,1 ms Warten auf die Speicherung. Das TV-Paket wird
rund 74 ms nach dem Client-Versandstempel eingereiht, die Admin-Pakete kurz
danach. Ein GC-Ereignis von 4,4 ms überlappt diesen Ablauf. Die 53 ms vor dem
Handler sind damit nicht als Wartezeit in der Match-Datenbank nachgewiesen.

Eine weitere Spitze bei 182 Sekunden enthält 14,9 ms Warten auf die
Spielstand-Ressourcensperren sowie anschließende Anzeige- und
Vorbereitungsnacharbeiten. Keiner der beobachteten Datenbankvorgänger ist
ein Sprachauftrag.

## Aussage zur Sprachgenerierung

Für Test 29 ist durch die Rückmeldung des Nutzers bestätigt, dass noch
Sprachbausteine generiert wurden. Für Test 30 bestätigt der Nutzer dagegen,
dass die Sprachvorbereitung bereits vollständig fertig war. Die höheren
Latenzen bei laufender Generierung und die Rückkehr zum vorherigen Niveau
bei fertigem Vorrat stützen damit einen indirekten Einfluss der
Generierungsarbeit. Die geprüfte funktionale Trennung schließt einen
Sprachauftrag in der Turnier-Datenbankwarteschlange im aktiven Prozesspfad aus.

Eine Unterscheidung zwischen CPU-Konkurrenz, Datenträgerlast und anderer
begleitender Arbeit ist mit diesen Daten nicht möglich. Die Turnierstände
und Ereignisse unterscheiden sich; die Exporte enthalten weder die genaue
Generierungszeitachse noch Prozess-CPU-Messungen der Synthese. Das ist ein
Hinweis aus zwei unterschiedlichen Läufen, kein kontrollierter kausaler
Nachweis. Auch Browser-Audioanbieter und Fallbacks werden nicht protokolliert.

Die [anonymisierten Messdaten](performance_test30_2026-10-24.json) enthalten
die Vergleichswerte, die 15 langsamsten Empfangsmeldungen und detaillierte
Zeitleisten für acht davon. Der laufende BTS, seine Einstellungen sowie
produktive Turnier- und BTP-Daten wurden bei dieser Auswertung nicht verändert.
