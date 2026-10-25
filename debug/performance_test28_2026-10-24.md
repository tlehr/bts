# Test 28: Empfangslatenz und Tempo der Ansagebausteine

Der Benchmark läuft am 24.10.2026 von 18:31:25 bis 18:41:25 Uhr in Berlin,
600.154 ms, ohne Testfehler durch. Anfangs sind 373 Spiele vorhanden,
105 beendet und 13 aktiv. Alle 1.157 Spielstandmeldungen erreichen TV und
Admin; keine Meldung bleibt ohne Zuordnung.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Über 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 8,0 ms | 5 ms | 24 ms | 41 ms | 75 ms | 4 |
| Admin | 10,7 ms | 7 ms | 28 ms | 43 ms | 76 ms | 6 |

Es gibt keine Meldung über 100 ms. Das p99-Ziel unter 30 ms wird weiter
verfehlt. Gegenüber Test 27 sinken die Maxima von 129/136 auf 75/76 ms,
während p99 von 36/41 auf 41/43 ms steigt. Die Turnierstände und konkreten
Ereignisse unterscheiden sich; das ist kein isolierter A/B-Nachweis.

| Phase | Updates | TV p99 / Maximum | Admin p99 / Maximum |
| --- | ---: | ---: | ---: |
| Anmeldung und Spielbetrieb | 288 | 28 / 43 ms | 33 / 51 ms |
| Last | 560 | 41 / 75 ms | 43 / 76 ms |
| Last nach der Ruhephase | 309 | 41 / 48 ms | 45 / 61 ms |

598 Telemetrieproben und 9.711 Traces sind vorhanden. Keine Probeabfrage
schlägt fehl; es gibt keine Archivlücken oder verworfenen Einträge. Der Bericht
meldet keinen anhaltenden Rückstau. Die Entleerung während der Pause dauert
955 ms. Der Export enthält keine Browserprotokolle zur tatsächlichen
Audioausgabe oder zu deren Fallback-Anbieter.

## Verbleibende Spitzen

Die größte Spitze liegt rund 192,7 Sekunden nach Testbeginn. Der zugehörige
Score-Trace 3646 wartet 61,4 ms auf `fetch_sync_apply`; TV/Admin empfangen
die Meldung nach 75/76 ms. Weitere hohe Werte enthalten verzögerte
Match-Schreibvorgänge und wartende Match-/Anzeigeeinstellungsabfragen.
Nacharbeiten für Geräteinformationen verlängern außerdem die gehaltenen
Sperren. Diese Zeitintervalle überlappen; sie sind keine addierbaren CPU-Zeiten.

Die gemessenen Sprach-Snapshot-Pakete liegen bei p99 0,6 ms, Maximum 3,3 ms;
die Sprach-IPC-Sendeschritte bei p99 0,5 ms, Maximum 9,9 ms. Die
Vorbereitungsberechnung hat 11.573 gemessene Pakete mit p99 5,3 ms und
Maximum 19 ms. Der langsamere Vortrag eines Audiobausteins erklärt diese
Score-Latenzen nicht. Eine zeitliche Überlappung mit einer Sprachanfrage allein
belegt keine Verursachung durch Audio.

Die [anonymisierten Messdaten](performance_test28_2026-10-24.json) enthalten
Phasen, Ausreißer und die jeweiligen längsten gemessenen Abschnitte.

## Langsame Platzierungsrunden

Der bisherige V2-Plan erzeugt die Rundenbezeichnung isoliert. Bei Spielnummern,
Disziplinen und Namen liefert ein längerer Kontext dagegen die Satzmelodie.
Der allgemeine Tempofaktor ist gleich: für den Hallensprecher 1,155.
Im geprüften Cache dauert „Spiel um Platz fünf und sechs“ 2,74 Sekunden.
Die längsten erkannten inneren Pausen dieses Clips liegen nur bei rund 80 ms;
die vorhandene Prüfung auf sehr lange Pausen erkennt langsames Sprechen
deshalb nicht als Fehler.

Alle noch isolierten regulären V2-Fragmente erhalten jetzt längere Quellen:
Runden, Feldhinweise in Vorbereitung und Treffpunkt-Aufforderungen. Auch der
letzte V2-Ersatzversuch für Namen verwendet einen anderen vollständigen Satz
statt eines isolierten Namens. Hörbarer Text, Reihenfolge und Montagepausen
bleiben gleich. Bereits vorhandene Kontextquellen für Namen, Rollen,
Spielnummern, Disziplinen und feste Anmeldetexte bleiben erhalten.

Drei Proben wurden mit den installierten Modell- und Stimmdateien in einem
getrennten Prozess mit zwei Threads und niedriger CPU-Priorität erzeugt und
durch die echte Quellenprüfung, Ausrichtung und Wiedergabeaufbereitung
verarbeitet. Alle drei gelingen. Die Platzierungsrunde dauert darin 1,61 statt
2,74 Sekunden, bei gleichem Tempofaktor. Das ist eine Messung dieser Probe,
keine Garantie für jede Runde oder jede neue Synthese. Subjektive Klangqualität
und Übergänge sind noch anzuhören.

Der [direkte Hörvergleich](speech-tempo-2026-10-24/context-preflight/index.html)
enthält alte und neue Aufnahmen sowie die vollständigen neuen Kontextquellen.
Die [Tempo-Prüfung](speech-tempo-2026-10-24/index.html) bietet zusätzlich
Messwerte des vorhandenen Vorrats und ein tonhöhenerhaltendes Hörtempo nur
für diese Seite. Sie stellt keine Syntheseanfragen und ändert den Cache nicht.
Silben- und Stillewerte sind heuristische Hinweise für die Hörprüfung.

185 automatische Tests, der Chrome-Integrationstest und die drei echten
Generierungs-/Schnittproben bestehen. Lint, Syntax und `git diff --check`
bestehen. Nach einem BTS-Neustart und Neuladen der Adminseiten werden die
geänderten Rezeptschlüssel automatisch berücksichtigt. Betroffene Teile
müssen neu vorbereitet werden; gültige andere Aufnahmen werden nicht gelöscht.
