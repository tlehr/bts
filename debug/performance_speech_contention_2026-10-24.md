# CPU-Priorität der Sprachgenerierung, 24.10.2026

Der kontrollierte Vergleich spricht für eine niedrigere CPU-Priorität des
Sprachservers bei unverändert vier Threads. Er reproduziert **nicht** die
starke Verschlechterung aus Test 29. Die Ergebnisse belegen deshalb keine
alleinige Ursache für dessen Verzögerungen.

## Messung

Acht Läufe auf diesem Rechner (i7-4770, acht logische CPUs), zwei Durchgänge
mit umgekehrter Variantenreihenfolge. Jeweils 60 Sekunden, 750 identische
Spielstandmeldungen, 373 fiktive Spiele, 13 Tablets, 13 TVs, elf Admin-Sockets
und ein Turnierabruf pro Sekunde. NeDB ist dateibasiert. Sprachmodell und
identische native Sprachprobe werden vor jedem Messfenster geladen/erzeugt.
Während der drei aktiven Varianten laufen reale Kontext-V2-Synthesen und
Audio-Cache-Schreibzugriffe in separaten Prozessen.

Zusammengefasste Empfangslatenzen aus jeweils 1.500 Spielstandmeldungen:

| Variante | TV p99 | Admin p99 | TV Maximum | Admin Maximum | Fertige Audio-Jobs je Messminute |
| --- | ---: | ---: | ---: | ---: | --- |
| Modell geladen, keine Generierung | 27,5 ms | 37,3 ms | 320,7 ms | 371,3 ms | – |
| Generierung, vier Threads, normale Priorität | 26,8 ms | 38,2 ms | 67,9 ms | 239,0 ms | 3 / 3 |
| Generierung, zwei Threads | 22,5 ms | 30,7 ms | 39,7 ms | 144,6 ms | 1 / 1 |
| Generierung, vier Threads, Nice 10 | 21,2 ms | 28,5 ms | 43,5 ms | 156,1 ms | 3 / 3 |

Die Einzelwerte für TV/Admin p99 waren ohne Generierung 32,7/43,2 und
24,6/31,8 ms; bei normaler Generierung 22,8/35,3 und 28,3/40,6 ms; mit zwei
Threads 22,9/28,1 und 22,2/30,7 ms; mit Nice 10 21,1/27,3 und 21,5/31,4 ms.
Die Kontrollläufe schwanken merklich. Wenige Wiederholungen erlauben keine
präzise Vorhersage einer Live-Latenz oder eine belastbare Prozentangabe zur
allgemeinen Beschleunigung.

Alle 6.000 gemessenen Meldungen erreichten TV und den festgelegten Admin.
Fixtures, Eingabefolgen und gespeicherte Endzustände waren identisch; alle
NeDB-Dateien wurden erneut geladen und mit dem Speicherzustand verglichen.
Es gab keine fehlerhaften Server-Traces oder fehlgeschlagenen Audio-Jobs.

## Ressourcen und Datenbank

Der native Vier-Thread-Prozess nutzte während der aktiven Messfenster etwa
311–335 Prozent eines CPU-Kerns; bei zwei Threads 183–187 Prozent. Der
BTS-Hauptprozess lag in diesen Varianten bei etwa 22–25 Prozent eines Kerns.
Nice 10 ist eine Scheduler-Priorität, keine CPU-Obergrenze. Sie schützt BTS
bei Konkurrenz um Rechenzeit, verhindert aber keine einzelnen Ausreißer.

Die Wartezeit auf den NeDB-Schreibcallback lag in den aktiven Varianten bei
7,8–13,2 ms p99; die synchrone Serialisierung bei 1,0–3,9 ms p99. Diese
Callback-Zeit beinhaltet Betriebssystem- und Event-Loop-Wartezeit. Daraus
lässt sich keine reine Datenträger-Servicezeit ableiten.

Der Sprachprozess greift weiterhin ausschließlich auf übergebene Turnier-
Snapshots zu. Die eigentlichen Turnier-Datenbankqueues werden nicht von der
Sprachgenerierung belegt. Synthese, Alignment und Audio-Cache-Schreiben
benötigen dennoch CPU und Dateisystemressourcen desselben Rechners. Die
gemessenen I/O-Volumina allein weisen keine Datenträgerüberlastung nach.

Die ursprüngliche Messung von `server.loop` lief versehentlich bis nach dem
abschließenden Datenbank-Neuladen. Diese Werte sind im kompakten Bericht
ausgeschlossen; Empfangszeiten, CPU-/I/O-Differenzen und Schreibphasen wurden
vor der abschließenden Validierung erfasst. Der Messhelfer stoppt den
Event-Loop-Monitor inzwischen vor dieser Validierung.

## Änderung

Der reguläre Start des Sprachservers setzt vor dem Aufbau der API und ihrer
nativen Kindprozesse standardmäßig `BTS_PROCESS_NICE=10`. Die Vorgabe kann
mit 0 deaktiviert werden; eine bereits strengere geerbte Priorität bleibt
erhalten. Nicht unterstützte Systeme behalten ihre vorhandene Priorität.
Fehler beim Setzen werden protokolliert und verhindern den API-Start nicht.

Vier Synthese-/Decoder-Threads bleiben erhalten. Ihre Änderung würde auch
die Audio-Identität verändern und neue Vorbereitungen auslösen. Die
CPU-Priorität hat keinen Einfluss auf Audio-Fingerprints oder die öffentliche
Konfigurationsversion; vorhandene Aufnahmen bleiben gültig. Die Änderung
wirkt beim nächsten regulären Sprachserverstart. Laufende Benutzerdienste
und BTP wurden bei diesen Messungen nicht verändert.

## Integrierte Bestätigung

Anschließend lief die unveränderte feste Zehn-Minuten-Sequenz des
Turniertestclients mit seinem separaten Empfangsprozess. Derselbe Rechner,
373 fiktive Spiele, 13 Tablets/TVs, zehn zusätzliche Admin-Verbindungen,
produktiver integrierter Sprachprozess und echter Kitten-Server mit Nice 10.
Sprachplan, Queue und Spielübersicht wurden alle zwei Sekunden abgefragt.

| Abschnitt | Updates | TV p99 / Maximum | Admin p99 / Maximum |
| --- | ---: | ---: | ---: |
| Erste zwei Minuten | 303 | 29 / 39 ms | 31 / 39 ms |
| Last | 624 | 29 / 48 ms | 31 / 51 ms |
| Zwei Minuten Ruhe | 0 | – | – |
| Last nach der Ruhephase | 308 | 25 / 40 ms | 28 / 39 ms |
| Insgesamt | 1.235 | **28 / 48 ms** | **29 / 51 ms** |

Alle Meldungen wurden vollständig zugeordnet; keine verlorene Zustellung,
keine fehlerhaften Server-Traces und keine fehlgeschlagene Sprachabfrage.
Die 302 Abfragerunden dauerten maximal 755 ms. Die Inferenz überlappte den
Messlauf für rund 505 Sekunden. Gemessen wurden etwa 314 Prozent eines Kerns
im nativen Modellprozess, 65 Prozent im isolierten Node-Sprachprozess und
16,6 Prozent im BTS-Hauptprozess. API und nativer Kindprozess hatten die
geprüfte Priorität Nice 10, BTS und seine Sprachverwaltung Nice 0.

Vor dem Messfenster wurde ein Spielabschluss samt automatischem Folgeaufruf
geprüft; im Test kamen vier weitere Abschlussbestätigungen hinzu. Alle
Belegungsstichproben zeigten 13 besetzte Felder. Die gespeicherte NeDB wurde
abschließend erneut geladen und vollständig mit dem Speicherzustand verglichen.

Die Audio-Qualitätsprüfung lehnte einen Ausschnitt „In Vorbereitung“ wegen
`cut_inside_speech` ab und forderte eine neue Kontextquelle an. Das ist im
Testlog erfasst; vollständige Audio-Bereitschaft oder Klangqualität werden
durch den Performance-Test nicht bescheinigt.

Ein vorheriger integrierter Versuch wurde abgebrochen, weil den fiktiven
Spielen externe Referenzen fehlten, die der automatische Aufruf auch bei
deaktiviertem BTP zunächst liest. Die Testdaten enthalten diese Referenzen
jetzt; die zusätzliche Abschluss-/Folgeaufruf-Vorprüfung besteht. Der
abgebrochene Versuch wurde nicht als erfolgreiche Bestätigung gewertet.

Das Gesamt-p99 liegt hier unter 30 ms. In den ersten beiden Phasen liegt
Admin-p99 noch bei 31 ms. Der Lauf ist eine Bestätigung mit künstlichen
Turnierdaten und leerem Audio-Cache, kein gepaarter A/B-Vergleich mit dem
ursprünglichen Test 30: Es gab keine offenen Spieler-Check-ins, keine
BTP-Abgleiche, kein Browser-Rendering und keine hörbare Ausgabe. Die Ursache
von Test 29 ist damit weiterhin nicht abschließend geklärt.

[Kompakte Daten des integrierten Laufs](performance_speech_integrated_2026-10-24.json).
Vollständige Rohdaten: `/tmp/bts-speech-integrated-real-20261024-b.json` und
`/tmp/bts-speech-load-dQB5M2/report.json`.

## Weitere Nachweise und Grenzen

19 gezielte Python-Tests zu Priorität, Startreihenfolge, Konfiguration,
Modellauswahl, Cache-Identität und API-Cache-Verhalten sowie fünf Tests des
Lastgenerators bestanden. ESLint und Python-Syntaxprüfung bestanden. Der
erste zusätzliche API-Testlauf im eingeschränkten Sandkasten blieb stehen;
die Wiederholung mit zugelassenen lokalen Test-Sockets bestand in 1,64 Sekunden.

Die kontrollierte Messung lässt dieselben 13 Spiele aktiv und schaltet die
Sprachverwaltung im gemessenen BTS aus, um externe Ressourcenlast getrennt
zu prüfen. Browser-Rendering, hörbare Ausgabe, BTP-Abgleiche und weitere
reale Clients sind nicht enthalten. Die integrierte Bestätigung prüft
zusätzlich die Sprachverwaltung und ihre Abfragen, mit den oben genannten
Grenzen.

[Kompakte Messdaten](performance_speech_contention_2026-10-24.json),
[Messverfahren und Aufruf](speech_load/README.md).
Die vollständigen Rohdaten liegen lokal unter
`/tmp/bts-speech-load-real-20261024-a.json` und
`/tmp/bts-speech-load-dJ3a1I/report.json`.
