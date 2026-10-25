# Test 21: Erste Durchsage fordert das falsche Audioformat an

Die passenden V2-Aufnahmen für die erste Vorbereitungsansage waren vorhanden.
Zur ersten Sprachabfrage wurde jedoch eine alte Einzeltext-Variante neu
angefordert. Ein reproduzierbarer Fehler im Startablauf erklärt, wie ein früh
geöffnetes Browserfenster trotz fertiger Kontextaufnahmen in den Browser-Fallback
geraten kann. Die Metadatenübernahme und die Zusammensetzung wartender Ansagen
sind korrigiert. Gleichzeitig sind unnötige Anzeigeabfragen bei Check-ins
entfernt. Die Wirkung auf die gesamte Live-Latenz braucht einen weiteren Lauf.

## Gelieferter kurzer Lauf

`bts-test-21.json`: 24.10.2026, 12:24:00 UTC / 14:24:00 Uhr in Berlin;
42.736 ms Laufzeit, vom Nutzer unterbrochen, kein gemeldeter Testfehler.
Anfangs 373 Spiele, davon 87 beendet und 13 aktiv. Alle Optimierungsflags aus
Test 19 sind vorhanden, einschließlich `score_readonly_reads`. Der Sprachdienst
läuft als eigener Prozess.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 17,1 ms | 12 ms | 49 ms | 61 ms | 90 ms | 101/101 |
| Admin | 21,5 ms | 15 ms | 59 ms | 70 ms | 106 ms | 101/101 |

Die wenigen Proben erlauben keinen stabilen Langzeitvergleich. Im Zeitfenster
der ersten Durchsage steigt die gemessene Hauptthread-Auslastung auf nahezu
100 Prozent; die Event-Loop-Timermessung erreicht rund 95 ms bei 20-ms-Auflösung.
Die beiden `speech_resolve`-Handler werden nach 13,9 und 158,9 ms beantwortet.
Ein erfolgreicher Handlerabschluss belegt dabei nicht, dass alle angefragten
Clips fertig sind. Die damaligen Browser-Fallback-Gründe und Clipstatus sind
im gelieferten Bericht nicht enthalten.

## Vorhandene Kontextaufnahmen und unerwartete Neugenerierung

Die aktuelle Cache-Metadatei und die referenzierten WAV-Dateien wurden nur
gelesen. Für die Vorbereitungsansage von Spiel 102 lassen sich sieben passende
V2-Bausteine unter der aktuellen Cache-Identität rekonstruieren. Alle sieben
Dateien sind vorhanden; ihre Änderungszeiten liegen am 22.10.2026.

Zusätzlich wurde die lokale Sprachserver-Datenbank unter
`data/context-v2/jobs.sqlite3` mit SQLite `mode=ro` abgefragt. Sie bestätigt
folgende neuen Einzeltext-Aufträge; Uhrzeiten in UTC:

| Ereignis | Zeitpunkt am 24.10.2026 |
| --- | --- |
| Erste `speech_resolve`-Abfrage im BTS | 12:24:26.382 |
| Neuer Einzeltext-Auftrag „Spiel Nummer 102“ | 12:24:26.493 |
| Dieser Einzeltext ist fertig | 12:24:48.438 |
| Neuer Einzeltext-Auftrag für die Platzierungsrunde | 12:24:50.805 |
| Zwei weitere Einzeltext-Aufträge für Namen | 12:25:05.909 / 12:25:19.980 |

Diese Jobs gehören zu den alten Einzeltext-Schlüsseln. Die bereits fertigen
V2-Bausteine haben andere Schlüssel und enthalten passende Aufnahmen im
Satzkontext. Die spätere Fertigstellung der zusätzlich angefragten Einzeltexte
kann die erste Durchsage innerhalb ihrer 700-ms-Wartefrist nicht versorgen.
Die zusätzlichen Jobs laufen teilweise noch nach dem Testende weiter.

Der Bericht enthält die ursprünglichen Browser-Payloads nicht. Die Kombination
aus Zeitstempeln, rekonstruierter Ansage und neu angelegten Einzeltext-Jobs
weist auf den falschen Zusammensetzungsweg hin. Den damaligen genauen
Fallback-Code oder den geladenen JavaScript-Stand des Browserfensters kann
man daraus nicht nachträglich auslesen.

## Reproduzierter Startfehler und Korrektur

Ein Fenster kann seine Turnierdaten erhalten, bevor die Sprach-Metadaten
verfügbar sind. Ohne Kontextversion baut es eine Ansage aus Einzeltexten.
Diese lokale Zusammensetzung blieb bisher auch in der Wiedergabewarteschlange
fest. Eine später eintreffende Sprachkonfiguration änderte die schon erzeugten
Teile nicht. Außerdem gab `speech_service.status()` die Antwort bisher nur an
seinen Aufrufer zurück, ohne die Metadaten selbst zu übernehmen.

Jetzt übernimmt eine Statusabfrage die Sprachkonfiguration. Bei unbekannter
Kontextversion erfolgt vor einer Spielansage zunächst eine reine Statusabfrage.
Die Zusammensetzung wird direkt vor der Wiedergabe mit der aktuellen
Kontextversion neu erstellt. Das gilt auch für eine wartende Ansage, deren
Textbaustein-Funktion noch ein älteres Turnierobjekt hält. Aufrufart und Spiel
werden pro Ansage festgehalten, damit mehrere wartende Spiele nicht verwechselt
werden.

Scheitert die Metadatenabfrage, werden keine alten Einzeltexte zur Generierung
eingereicht. Abbruch sowie Turnier- oder Stimmenwechsel während dieser Abfrage
verhindern eine verspätete Ausgabe. Die Browser-Sätze bleiben erhalten;
Browsermodus und tatsächlich angekündigte ältere Serverformate funktionieren
weiterhin. Die bisherige Frist für die Clip-Abfrage bleibt unverändert.

Für weitere Berichte zeichnet `speech_resolve_result` nur die Anzahl der Teile,
Kontextteile und fertig gemeldeten Clips sowie einen möglichen Fehlergrund auf.
Spielernamen und Ansagetexte werden nicht in diesen Trace aufgenommen.

## Gleichzeitiger Belastungspfad bei den Check-ins

Unmittelbar nach der ersten Durchsage werden vier Spieler desselben Spiels
eingecheckt. Jeder Check-in löste bisher eine globale Anzeigeaktualisierung aus,
weil das Spiel noch kein Feld hatte. Die V2-Verarbeitung fragte dadurch jedes
belegte Feld samt Spiel erneut ab. Zusätzlich baute der V1-Pfad vollständige
Turnier-/Spielpakete auf, auch wenn kein passender V1-Empfänger verbunden war.
Gleichzeitig läuft ein BTP-Abgleich mit Planungswiederholungen.

Die Check-in-Handler warten im Bericht unter anderem auf Turnier- und
Matchabfragen sowie vorherige Check-ins. Die nachgelagerten Feldaktualisierungen
einzelner Check-ins benötigen rund 136–226 ms. Diese Zeitspannen enthalten
Queue-Warten und überlappen; sie sind keine addierbaren CPU-Zeiten.

Match-Änderungen tragen nun ihre Match-ID bis in die V2-Benachrichtigung, auch
beim Wiederabspielen serialisierter BTP-Effekte. Änderungen an einem Spiel ohne
Feld aktualisieren weiterhin Picker, Anzeigen dieses Spiels und passende
Mehrfeldanzeigen. Andere belegte Felder brauchen keine Kontextabfrage.
Explizite Meldungen für ein bisheriges Feld und absichtliche globale Refreshs
bleiben verfügbar. V1 prüft seine tatsächliche Empfängerbedingung vor dem
Aufbau der Pakete.

Ein Reproduktionstest verwendet vier echte Admin-Check-ins, 13 unterschiedliche
belegte Felder mit V2-Testempfängern und ein weiteres Tablet. Mit dem gesicherten
vorherigen Code entstehen 108 V2-Kontextabfragen; mit der Korrektur keine.
Die vier Check-ins werden weiterhin gespeichert und als Admin-Änderung
übertragen. Der Test ersetzt die nachgelagerte Aufrufautomatik durch neutrale
Callbacks und verwendet temporäre Datenbanken. Er ist ein Nachweis vermiedener
Arbeit, kein isolierter Nachweis einer bestimmten Live-p99-Latenz.

## Prüfungen

- 368 Regressionstests für Sprache, Cache, Check-ins, BTP-Abgleich,
  Benachrichtigungen, Reihenfolge, Datenbankspeicherung und Priorität bestanden.
- Nach den zusätzlichen Fällen für ein älteres Turnierobjekt und die
  Diagnoseausgabe bestanden 99 unmittelbar betroffene Prüfungen; eine weitere
  gezielte Prüfung mit 75 Fällen deckt beide Match-ID-Formate bei Feldanzeigen
  sowie deaktivierte und nicht unterstützte Sprachausgabe ab.
- Vier ausgewählte Integrationsprüfungen mit echtem Chrome, echten
  WebSocket-Aufrufen und lokalem FastAPI-Testserver bestanden, darunter native
  Wiedergabe, wiederverwendete Aufnahmen und der tatsächliche Match-Aufruf.
  Der Testserver verwendet eine kleine Test-Synthese, kein Produktionsmodell.
- Der neue Start-Reproduktionstest scheitert mit dem vorherigen Code mit
  `provider: browser`; mit der Korrektur verwendet bereits die erste Ansage
  Server-Audio und fordert keine alten Einzeltexte an.

Die vollständigen Cacheaufnahmen und Sprachserver-Daten wurden für die
Untersuchung nur gelesen. Es wurden keine Testpunkte an das laufende Turnier
oder BTP gesendet. Die [anonymisierten Messdaten](performance_test21_2026-10-24.json)
enthalten Kennzahlen und Zeitstempel ohne Spielernamen.

Die Serveränderung benötigt einen BTS-Neustart. Alle geöffneten BTS-Fenster
müssen einmal mit Strg+F5 den geänderten Browsercode laden. Danach ist ein neuer
Lauf nötig, um die Wirkung auf die gesamte Latenz zu messen.
