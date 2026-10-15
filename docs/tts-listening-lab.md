# Hörvergleich für lokale Ansagebausteine

Start im BTS-Repository:

```bash
bash scripts/tts-listening-lab.sh --generate
```

Danach [http://127.0.0.1:8078/](http://127.0.0.1:8078/) öffnen. Bei einem anderen Installationspfad `BTS_SPEECH_PROJECT=/pfad/zum/bts-sprachserver` setzen; `--port 8079` wählt einen anderen lokalen Port. Vorausgesetzt sind der installierte Kitten-Sprachserver mit vorbereiteten eigenen Stimmen, seine native Build-Umgebung sowie Node und FFmpeg.

Das Werkzeug baut einmal einen **separaten** Hörtest-Worker gegen die vorhandenen Bibliotheken. Modell, Decoder und Stimmen werden aus der geprüften Installation gelesen. Es startet oder beendet keinen produktiven BTS-/Sprachserver, ändert weder `.env` noch Stimmenprofile und verwendet nicht dessen SQLite-/Audio-Cache. Die Testdateien liegen ausschließlich unter `bts-sprachserver/data/listening-lab/`.

## Fester Beispieltext

```text
Auf Spielfeld 8! Spiel 189.  Mädcheneinzel U19.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz. Auf Spielfeld 8!
```

Die Doppel-Leerzeichen und die Schreibweise `LeandraGalowicz` bleiben im Original erhalten. Die Sprechfassung verwendet die echte BTS-Zahlenausschreibung. Es wird kein „Nummer“ zu „Spiel 189“ ergänzt. Die Struktur in `scripts/tts-listening-plan.js` lässt sich bearbeiten; vor jedem Vergleich wird sie neu gelesen, ohne das Modell zu laden.

Nach der Hörbewertung ist **Variante 1 der klangliche Favorit**. Der Standardvergleich zeigt deshalb jetzt nur **1 und 5**. Über „Alle fünf Fassungen“ bleiben die bisherigen Versuche erreichbar. Es wird nur das erzeugt, was für die gewählte Auswahl fehlt.

| Fassung | Zweck |
| --- | --- |
| Am Stück | Zusammenhängende Referenz mit dem vollständigen vorgegebenen Text und seinen Satzzeichen |
| Bisherige Bausteine | Bisherige Texte ohne abschließende Satzzeichen, Namen und „gegen“ getrennt |
| Mit Satzzeichen | Feld/Runde mit Ausrufezeichen, Spiel/Disziplin mit Punkt, beide Namen mit neutralem Komma |
| Namen zusammen | Wie oben; beide Namen mit „gegen“ als gemeinsamer Satz statt drei einzelner Aufnahmen |
| Langer Spielblock | Spielfeldansage separat; Spielnummer, Disziplin, Runde und beide Namen als ein vollständiger Block; dieselbe Spielfeldaufnahme nochmals am Ende |

Variante 5 prüft den Kompromiss zwischen Satzmelodie und Wiederverwendung. Der Spielblock enthält kein Feld und kann deshalb nach einer Feldänderung erhalten bleiben. Seine inneren Pausen werden nicht gekürzt. Bei diesem Beispiel benötigt er 117 Zeichen statt 157 Zeichen für die komplette Durchsage. Die Feldansage hat 19 Zeichen, wird einmal erzeugt und sowohl am Anfang als auch am Ende verwendet. Im vorhandenen Hörtest-Cache fehlt nur die eine neue Aufnahme des Spielblocks. Gegenüber der kleinsten Stückelung geht weiterhin Wiederverwendung von Namen, Disziplin und Runde verloren; die Variante ist kein Versprechen gleicher Cache-Effizienz. Die produktive Ansage wurde noch nicht umgestellt.

Die wiederholte Feldansage verwendet jeweils dieselbe Aufnahme. Die drei Bausteinfassungen werden alle mit derselben neuen Montage verarbeitet; die zweite Fassung bildet die bisherige **Textstückelung**, nicht zusätzliche variable Ladepausen des produktiven Browsers ab. Namen bekommen in der dritten Fassung dieselbe Kommaform unabhängig von ihrer Position. Das ist eine Hörtest-Variante, keine bereits freigegebene Betonungsregel für das Turnier.

## Einstellungen ohne Modellneustart vergleichen

Zunächst wird der Hallensprecher mit Temperatur 0,8, Top-k 50, Top-p 0,8 und Seed 42 erzeugt. Diese Werte gelten für alle Teile und Fassungen des Vergleichs. Die männliche Standardgeschwindigkeit 1,155 entspricht dem aktuellen BTS-Standard einschließlich seiner zusätzlichen zehn Prozent.

- **Pausen und Tempo:** vorhandene Testaufnahmen werden wiederverwendet. FFmpeg verändert je Clip das Tempo bei erhaltener Tonhöhe; danach werden feste Satz-/Verbindungspausen eingefügt. Es ist keine neue Inferenz erforderlich.
- **Temperatur, Top-k, Top-p und Seed:** fehlende Kombinationen werden neu generiert. Derselbe native Prozess hält Modell und Decoder dabei geladen. Für den nächsten Vergleich beispielsweise nur die Temperatur auf 0,6 setzen; alle übrigen Werte bleiben gleich.
- **Stimme:** beide eigenen Stimmen stehen bereit. Der Wechsel setzt im Formular das Standardtempo auf 1,155 beziehungsweise 1,05. Die Stimme gehört zum getrennten Test-Cache.
- **Zeichensetzung/Stückelung:** Änderungen des Plans erzeugen nur neue Sprechtexte. Unveränderte Bausteine und wiederholte Feldansagen werden weiterverwendet.

Vor der Montage nutzt der Hörtest die BTS-Kürzung langer nahezu stiller Wortlücken bei atomaren Bausteinen. Vollständige Referenz- und Namenssätze behalten ihre inneren Modellpausen. Nach der Tempoänderung werden stille Ränder bei der konservativen PCM16-Schwelle vier entfernt; zwischen den Clips liegen dann die eingestellten 250 ms Satzpause beziehungsweise 60 ms bei Namen/„gegen“. Jede komplette Hörprobe erhält 30 ms äußere stille Reserve. Die am Stück erzeugte Referenz behält ihre inneren Modellpausen. Rein stille Testausgaben werden nicht als Sprache zugeschnitten.

Jeder Durchlauf erzeugt je nach Auswahl zwei beziehungsweise fünf eigenständige WAVs und einen JSON-Bericht mit Original-/Sprechtexten, tatsächlichen Bausteinen, Parametern, Seed, Worker-PID, Cache-Treffern, Generierungszeiten und Dateihashes. Rohaufnahmen werden nicht überschrieben. Neue Resultate erscheinen über den bisherigen Resultaten, sodass Einstellungen direkt vergleichbar bleiben. Ein fester Seed macht unterschiedliche Texte nicht automatisch gleich betont; die Hörprobe entscheidet über die Qualität.

Der Dienst bindet ausschließlich an `127.0.0.1`; ein Vergleich läuft zur Zeit. Fremde Host-/Origin-Anfragen werden abgelehnt. Mit `Strg+C` wird nur der Hörtest samt seinem eigenen Worker beendet. Nach einem Neustart bleiben die Test-WAVs und Berichte erhalten. Das Modell wird erst geladen, wenn eine neue Aufnahme fehlt; reine Cache-/Montagevergleiche benötigen auch nach Neustart kein geladenes Modell. Änderungen an der produktiven Ansage werden erst nach Auswertung dieses Vergleichs übernommen.

## Erste Ausführung

Der echte Kitten-Worker erzeugte die 15 unterschiedlichen männlichen Aufnahmen mit Temperatur 0,8 und Seed 42 in insgesamt etwa 207 Sekunden Inferenzzeit. Bei Tempo 1,155 und Pausen 250/60 ms dauern die vier fertigen Fassungen etwa 11,68 / 16,67 / 16,43 / 15,79 Sekunden. Das ist eine Messung dieses Durchlaufs, keine Qualitätsrangfolge. Die WAVs und der vollständige Bericht liegen unter `bts-sprachserver/data/listening-lab/de27c91aa9b9/`.

Ein echter Chrome spielte die dritte WAV nativ vollständig ab; Desktop- und Mobilansicht wurden geprüft. Eine Änderung der Satzpause auf 300 ms erzeugte anschließend **null** neue Clips, verwendete dieselben Roh-WAV-Hashes und behielt Worker-PID 2305824. Der zweite Bericht liegt unter `data/listening-lab/5790056a3920/`. Die einzelnen Testordner werden beim Commit nicht eingecheckt. Zusätzlich bestanden 16 gezielte BTS-Tests sowie alle 91 regulären Sprachserver-Tests; zwei sonstige CPU-Integrationstests blieben ausdrücklich deaktiviert. Die akustische Bewertung der vier Varianten erfolgt durch den Betreiber.

## Spielblock nach der Hörbewertung

Die Hörbewertung bevorzugt Variante 1 deutlich. Deshalb bleibt ihre Audiodatei im neuen Vergleich bytegleich erhalten. Variante 5 ergänzt nur eine neue Aufnahme des feldunabhängigen Spielblocks. Unter denselben Einstellungen benötigte sie etwa 26,9 Sekunden Inferenz und ergibt mit der vorhandenen Feldansage eine 13,64 Sekunden lange Durchsage. Beide WAVs und der Bericht stehen unter `data/listening-lab/df5cdddaa167/` im Sprachserver-Repository.

Die ursprünglichen Messungen zeigen für dieses eine Beispiel etwa 39,6 Sekunden beim vollständigen Ruf und zusammen 82,3 Sekunden für die sieben unterschiedlichen kleinen Bausteine im kalten Cache. Diese Zahlen enthalten nicht den späteren Vorteil der Wiederverwendung kleiner Bausteine über viele Spiele; eine allgemeine Geschwindigkeitsrangfolge folgt daraus nicht. Ganze Spielblöcke müssen weiterhin mehr Angaben erneut vertonen als die kleinste Stückelung. Ihr Vorteil gegenüber vollständigen Rufen je Feld ist die unabhängige Feldzuweisung.

94 reguläre Sprachserver-Tests und 17 gezielte BTS-Tests bestanden. Ein zusätzlicher echter Cache-Durchlauf (`4d10f2dbdcfd`) montierte die beiden Fassungen mit **null** neuen Clips, ohne überhaupt einen Modellprozess zu starten. Das neue Metadatum `preserve_inner_pauses` schützt die vollständige Referenz, die gemeinsame Namensphrase und den Spielblock; äußere Montagepausen bleiben einstellbar.

Die anschließende Hörbewertung beanstandet die separat erzeugte Spielfeldansage in Variante 5 als unnatürlich; Ziel bleibt der Klang von Variante 1. Variante 5 bleibt deshalb ein Vergleichsversuch und wurde nicht für den produktiven Aufruf übernommen.

## Kontrolle des Spielfeld-Caches

Die ursprüngliche Referenz und Variante 5 verwenden dieselbe Engine-/Stimmenidentität, Temperatur 0,8, Top-k 50, Top-p 0,8, Seed 42 und Tempo 1,155. Alle übrigen protokollierten Samplingwerte stimmen ebenfalls überein. Cache-Schlüssel und Dateihashes wurden gegen die tatsächlichen Rohdateien geprüft.

Eine unabhängige Neugenerierung von `Auf Spielfeld acht!` mit denselben Parametern, vier Modell- und vier Decoder-Threads ergab eine **bytegleiche** WAV zur gecachten Spielfeldaufnahme (SHA-256 `005e93eb6148d95017e164d48a55519a46b5226af5c1da7e9f7c7dd202db4ede`). Der separate Kontrollbericht liegt unter `data/listening-lab/audit-38033a6ac213/report.json`; keine vorhandene Aufnahme wurde überschrieben. Auch die optionale Kürzung innerer Wortlücken verändert diesen konkreten Spielfeldclip nicht. Für diesen Vergleich ist ein veralteter Cache somit keine Erklärung. Die Erzeugung im vollständigen Textkontext statt als Einzelaufnahme bleibt eine plausible Ursache der unterschiedlichen Betonung; eine akustische Ursachenprüfung ist damit nicht ersetzt.
