# Sprachlast und Spielstandübertragung vergleichen

Aus dem BTS-Checkout unter Linux:

```sh
node debug/speech_load_benchmark.js --seconds 60 --rounds 2 --point-ms 80 --output /tmp/bts-speech-comparison.json
```

Vier Varianten: geladenes, inaktives Modell; aktive Synthese mit vier Threads;
aktive Synthese mit zwei Threads; vier Threads mit Prozesspriorität Nice 10.
Die zweite Runde kehrt die Reihenfolge um. Jede Variante erhält dieselben
373 fiktiven Spiele, 13 Tablet-/TV-Verbindungen, elf Admin-Verbindungen,
78 Spielstandmeldungen zum Aufwärmen und dieselbe gemessene Eingabefolge.
Eine Admin-Verbindung lädt pro Sekunde das Turnier. Die Modellinitialisierung
und eine identische native Sprachprobe liegen vor dem Messfenster.

Die Spielstände wechseln absichtlich zwischen gültigen Zwischenständen mit
einer festen Historienlänge von 180 Eingaben. Spiele werden nicht beendet.
Dieser kontrollierte Vergleich isoliert externe Synthese- und Cachelast:
der separate produktive SpeechBroker erzeugt Kontextaufnahmen und Ausschnitte,
während die Sprachverwaltung im gemessenen BTS ausgeschaltet bleibt.

Ein ergänzender Lauf prüft den vollständigen integrierten Sprachprozess mit
dem unveränderten Turnier-Testclient und dessen Empfangsprozess:

```sh
node debug/speech_load_integration.js --seconds 600 --variants low-priority --output /tmp/bts-speech-integrated.json
```

Bei 600 Sekunden wird dessen feste zehnminütige Benchmarksequenz verwendet;
kürzere Läufe sind Funktionstests ohne diese Phasen. Zusätzlich sind zehn
Admin-Verbindungen offen. Sprachplan, Queue und Spielübersicht werden wie
in der Sprachvorbereitung alle zwei Sekunden abgefragt. Automatische Aufrufe
lassen nach Spielabschlüssen weitere fiktive Spiele auf die Felder folgen.
Vor dem Messfenster wird Spiel 1 beendet und der automatische Folgeaufruf
von Spiel 14 auf Feld 1 geprüft. Fiktive externe Spiel-/Feldreferenzen sind
auch bei deaktiviertem BTP vorhanden, weil die produktiven Abschlusswege sie
vor der Prüfung des deaktivierten Verbindungstreibers lesen.
Es werden keine Lautsprecher oder Browser gestartet und keine DOM-Zeiten gemessen.

Beide Programme benutzen ausschließlich frische Unterverzeichnisse von
`/tmp/bts-speech-load-*`, eigene NeDB-Dateien, eigene Sprachdatenbanken und
Audio-Caches sowie freie Loopback-Ports. Der Sprachserver liest vorhandene
Modelle und Stimmreferenzen; Downloads sind ausgeschaltet. BTP ist deaktiviert.
API-Schlüssel werden über private Pipes/IPC übergeben. Beim Beenden werden
die gestarteten Prozesse beendet. Die Ergebnisdatei darf vorher nicht existieren.

Voraussetzungen: installierte BTS-Abhängigkeiten, benachbarter
`bts-sprachserver` mit `.venv`, Kitten-Modellen und Kontext-V2-Alignment sowie
für den integrierten Lauf der über `testclient_bridge` auffindbare BTS-Testclient.
Der kontrollierte Lauf unterstützt `--speech-repository /pfad/zum/checkout`.

`--fake --seconds 2 --rounds 1 --variants idle,normal` prüft beim kontrollierten
Lauf nur die Verkabelung mit einem Sinuston. Solche Ergebnisse sind keine
Sprachsynthese- oder Performancebelege.

Die Berichte enthalten Empfangslatenzen für TV und einen festgelegten Admin,
Sendeverspätungen des Lastgenerators, tatsächliche Inferenz-Zeitfenster,
CPU-/I/O-Differenzen aus `/proc`, Event-Loop-Zeiten und instrumentierte
Datenbankphasen. Der kontrollierte Lauf prüft identische Fixtures, Eingaben,
Endzustände und unveränderte Quelldateien. Beide laden die gespeicherte
Spieldatenbank erneut und vergleichen sie mit dem Speicherzustand.

CPU-Prozente beziehen sich auf einen Kern (vier Kerne entsprechen 400 %).
I/O-Zähler enthalten Page-Cache-Zugriffe; sie beweisen keine Überlastung des
Datenträgers. Asynchrone Datenbankzeiten umfassen auch Wartezeit auf die
Callback-Ausführung. Kurzlebige Alignment-/FFmpeg-Prozesse können in den
CPU-Stichproben fehlen. Fremdlast und thermische Effekte sind nicht kontrolliert.
Kurze Varianten liefern deshalb Anhaltspunkte, keinen Kausalnachweis für einen
bestimmten Live-Test.
