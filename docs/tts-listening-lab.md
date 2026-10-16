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

Nach der Hörbewertung ist **Variante 1 der klangliche Favorit**. Der Standardvergleich zeigt deshalb jetzt **1, 5 und 6**. Über „Alle sechs Fassungen“ bleiben die bisherigen Versuche erreichbar. Es wird nur das erzeugt, was für die gewählte Auswahl fehlt. Variante 6 verwendet ausschließlich vorhandenes Audio und setzt eine passende, geprüfte Referenz voraus.

| Fassung | Zweck |
| --- | --- |
| Am Stück | Zusammenhängende Referenz mit dem vollständigen vorgegebenen Text und seinen Satzzeichen |
| Bisherige Bausteine | Bisherige Texte ohne abschließende Satzzeichen, Namen und „gegen“ getrennt |
| Mit Satzzeichen | Feld/Runde mit Ausrufezeichen, Spiel/Disziplin mit Punkt, beide Namen mit neutralem Komma |
| Namen zusammen | Wie oben; beide Namen mit „gegen“ als gemeinsamer Satz statt drei einzelner Aufnahmen |
| Langer Spielblock | Spielfeldansage separat; Spielnummer, Disziplin, Runde und beide Namen als ein vollständiger Block; dieselbe Spielfeldaufnahme nochmals am Ende |
| Kontextschnitt | Anfangs- und Schlussansage aus Variante 1 ausgeschnitten; der unveränderte Spielblock stammt aus Variante 5 |

Variante 5 prüft den Kompromiss zwischen Satzmelodie und Wiederverwendung. Der Spielblock enthält kein Feld und kann deshalb nach einer Feldänderung erhalten bleiben. Seine inneren Pausen werden nicht gekürzt. Bei diesem Beispiel benötigt er 117 Zeichen statt 157 Zeichen für die komplette Durchsage. Die Feldansage hat 19 Zeichen, wird einmal erzeugt und sowohl am Anfang als auch am Ende verwendet. Im vorhandenen Hörtest-Cache fehlt nur die eine neue Aufnahme des Spielblocks. Gegenüber der kleinsten Stückelung geht weiterhin Wiederverwendung von Namen, Disziplin und Runde verloren; die Variante ist kein Versprechen gleicher Cache-Effizienz. Die produktive Ansage wurde noch nicht umgestellt.

In den Varianten 2 bis 5 verwendet die wiederholte Feldansage jeweils dieselbe Aufnahme. Variante 6 erhält die unterschiedliche Betonung von Anfang und Ende der Referenz durch zwei Ausschnitte. Die Bausteinfassungen erhalten feste Montagepausen; die zweite Fassung bildet die bisherige **Textstückelung**, nicht zusätzliche variable Ladepausen des produktiven Browsers ab. Namen bekommen in der dritten Fassung dieselbe Kommaform unabhängig von ihrer Position. Das ist eine Hörtest-Variante, keine bereits freigegebene Betonungsregel für das Turnier.

## Einstellungen ohne Modellneustart vergleichen

Zunächst wird der Hallensprecher mit Temperatur 0,8, Top-k 50, Top-p 0,8 und Seed 42 erzeugt. Diese Werte gelten für alle Teile und Fassungen des Vergleichs. Die männliche Standardgeschwindigkeit 1,155 entspricht dem aktuellen BTS-Standard einschließlich seiner zusätzlichen zehn Prozent.

- **Pausen und Tempo:** vorhandene Testaufnahmen werden wiederverwendet. FFmpeg verändert je Clip das Tempo bei erhaltener Tonhöhe; danach werden feste Satz-/Verbindungspausen eingefügt. Es ist keine neue Inferenz erforderlich.
- **Temperatur, Top-k, Top-p und Seed:** fehlende Kombinationen werden neu generiert. Derselbe native Prozess hält Modell und Decoder dabei geladen. Für den nächsten Vergleich beispielsweise nur die Temperatur auf 0,6 setzen; alle übrigen Werte bleiben gleich.
- **Stimme:** beide eigenen Stimmen stehen bereit. Der Wechsel setzt im Formular das Standardtempo auf 1,155 beziehungsweise 1,05. Die Stimme gehört zum getrennten Test-Cache.
- **Zeichensetzung/Stückelung:** Änderungen des Plans erzeugen nur neue Sprechtexte. Unveränderte Bausteine und wiederholte Feldansagen werden weiterverwendet.

Vor der Montage nutzt der Hörtest die BTS-Kürzung langer nahezu stiller Wortlücken bei atomaren Bausteinen. Vollständige Referenz- und Namenssätze behalten ihre inneren Modellpausen. Nach der Tempoänderung werden stille Ränder bei der konservativen PCM16-Schwelle vier entfernt; zwischen den Clips liegen dann die eingestellten 250 ms Satzpause beziehungsweise 60 ms bei Namen/„gegen“. Jede komplette Hörprobe erhält 30 ms äußere stille Reserve. Die am Stück erzeugte Referenz behält ihre inneren Modellpausen. Rein stille Testausgaben werden nicht als Sprache zugeschnitten.

Jeder Durchlauf erzeugt je nach Auswahl bis zu drei beziehungsweise sechs eigenständige WAVs und einen JSON-Bericht mit Original-/Sprechtexten, tatsächlichen Bausteinen, Parametern, Seed, Worker-PID, Cache-Treffern, Generierungszeiten und Dateihashes. Die beiden Spielfeld-Ausschnitte aus Variante 6 sind zusätzlich einzeln abspielbar. Rohaufnahmen werden nicht überschrieben. Neue Resultate erscheinen über den bisherigen Resultaten, sodass Einstellungen direkt vergleichbar bleiben. Ein fester Seed macht unterschiedliche Texte nicht automatisch gleich betont; die Hörprobe entscheidet über die Qualität.

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

## Variante 6: Spielfeldansagen aus dem vollständigen Kontext

Der neue Versuch setzt den vorhandenen Spielblock aus Variante 5 zwischen die beiden Spielfeldansagen aus Variante 1. Die Ausschnitte behalten ihre bereits vertonten Samples und ihr Tempo; sie werden weder erneut generiert noch erneut beschleunigt oder im Inneren gekürzt. Nur nahezu stille äußere Ränder werden wie bei den anderen Clips entfernt. Zwischen Spielfeld und Spielblock liegen die einstellbaren Satzpausen, zunächst je 250 ms.

`scripts/tts-listening-context.json` enthält die geprüften Frame-Grenzen und den SHA-256 der vollständigen Referenz-WAV. Die Ermittlung verwendete lokale Wortzeitmarken von [Vosk](https://github.com/alphacep/vosk-api/blob/master/python/example/test_words.py) mit dem [kleinen deutschen Modell](https://alphacephei.com/vosk/models). Die Hilfspakete und das Modell liegen ausschließlich unter `/tmp/bts-tts-context-alignment`; sie sind keine Laufzeitabhängigkeit des BTS oder Sprachservers. Audio wurde nicht an einen Erkennungsdienst übertragen. Das Ergebnis dient nur zur Absicherung der Satzgrenzen, nicht als Bestätigung sämtlicher Namensaussprachen.

In der 24-kHz-Referenz liegt der erste Schnitt bei Frame 40800 (1,700 s), zwischen erkanntem Ende von „acht“ (1,65 s) und Beginn von „Spiel“ (1,86 s). Die Schlussansage beginnt als Ausschnitt bei Frame 242603 (10,108458 s), zwischen dem Ende des vorherigen Namens (10,05 s) und dem erkannten „Auf“ (10,32 s). Beide Stellen haben sehr niedrige Signalenergie. Der letzte Ausschnitt reicht bis zum Ende der Originaldatei, sodass das abschließende „acht“ erhalten bleibt.

Die Grenzen gelten ausschließlich für die vollständige WAV mit Hash `9c62e0f0389530fee6ab07eedeeb414b2b0d6669999f197866c9a6a11a2bcdd1`. Weicht die neu montierte Referenz ab, wird Variante 6 mit sichtbarem Hinweis ausgelassen; alte Grenzen werden nicht auf andere Stimmen, Tempi oder Generierungen übertragen. Reine Änderungen der Montagepausen bleiben möglich. Das ist ein gezielter Hörversuch mit festen, geprüften Grenzen; eine automatische Zerlegung beliebiger Aufrufe wurde damit nicht eingeführt.

Der erste Bericht `data/listening-lab/c7035da814f2/report.json` enthält unveränderte Referenzen 1 und 5 sowie Variante 6 mit 11,653 Sekunden. Die separaten Spielfeldclips dauern etwa 1,626 und 1,535 Sekunden. Ein Test-Engine-Typ verbot Modellladen und Inferenz ausdrücklich; der Durchlauf benötigte null neue Clips und keinen Modellprozess. Wortzeitmarken und Kontrolltranskripte liegen daneben. Die Beurteilung der Übergänge erfolgt im Hörvergleich.

97 reguläre Sprachserver-Tests und 18 gezielte BTS-Tests bestanden; die zwei opt-in CPU-Inferenztests blieben deaktiviert. Ein echter Chrome spielte Variante 6 und beide Einzelclips vollständig ab. Alle sechs Fassungen ließen sich ohne neue Inferenz anzeigen. Ein anderes Tempo ließ Variante 6 mit Hinweis aus; die Rückkehr zu 1,155 stellte denselben WAV-Hash wieder her. Die Mobilansicht wurde bei 390 Pixeln Breite geprüft. Tests mit synthetischen und echten Audios prüften die unveränderten Sprachsamples und exakt 6000 stille Frames je Übergang bei 24 kHz (250 ms).

## Alle Durchsagen für ein Beispielspiel

Der neue feste Hörsatz folgt dem [geplanten Aufbau im Arbeitsdokument](durchsagen-arbeitsdokument.md): vollständige Kontextaufnahmen erzeugen, daraus wiederkehrende Stücke ausschneiden und anschließend die Durchsagen montieren. Er verwendet Spiel 189 auf Feld 8 in Halle 2, Mädcheneinzel U19, Achtelfinale, Nina Keo Boun Khoune gegen LeandraGalowicz. Der Spielblock entspricht dem bisherigen Hörbeispiel mit „Spiel 189.“. Beispiel-Offizielle sind Alexandra Becker und Martin Hoffmann; die Bedienung bilden Lena Fischer und Tom Schneider.

Die Stimme ist der Hallensprecher mit den bisherigen Parametern 0,8 / 50 / 0,8, Seed 42 und Tempo 1,155. Alle Zahlen werden vor der Synthese durch die BTS-Funktion ausgeschrieben. Die Anzeige behält die Ziffern. Die bevorzugte vollständige Referenz und der vorhandene Spielblock werden wiederverwendet.

| Durchsage | Hörproben | Abgedeckte Fälle |
| --- | --- | --- |
| D01 | 2 | Feldaufruf mit allen Offiziellen und ohne Offizielle |
| D02 | 4 | Vorbereitung mit/ohne Feld, jeweils mit/ohne Treffpunkt |
| D03 | 2 | Startanweisung mit/ohne Feld |
| D04 | 2 | Zweiter Feldaufruf für Team 1 beziehungsweise Team 2 |
| D05 | 4 | Zweiter Vorbereitungsaufruf für beide Seiten, jeweils mit/ohne Treffpunkt |
| D06 / D07 | 4 | Zweiter Aufruf für Schiedsrichter und Aufschlagrichter, jeweils mit/ohne Feld |
| D08 | 4 | Zweiter Aufruf für Tablet-/Klapptafelbedienung, jeweils mit/ohne Feld |
| D09 / D10 | 4 | Zweiter Vorbereitungsaufruf für Schiedsrichter und Aufschlagrichter, jeweils mit/ohne Treffpunkt |
| D11 | 4 | Zweiter Vorbereitungsaufruf für Tablet-/Klapptafelbedienung, jeweils mit/ohne Treffpunkt |
| D12 | 2 | Kampflose Entscheidung für jede der beiden Seiten |
| **Gesamt** | **32** | **Alle 14 spielbezogenen Auslöser mit ergänzenden Varianten** |

Die Varianten betreffen dasselbe Beispiel-Einzelspiel und seine beiden Bedienpersonen. Weitere Paarungen, Stimmeneinstellungen und sämtliche Kombinationen optionaler Spielangaben werden nicht durchgeneriert. Anwesenheitskontrolle, freie Ansage, Sprachtest und Evakuierung gehören nicht zu diesem spielbezogenen Hörsatz.

Der Plan enthält **14 vollständige Quellen und 31 Wiedergabestücke**. Beide Teamstücke stammen ohne „gegen“ aus demselben Spielblock. Die vollständige Begegnung mit „gegen“ und der Spielkopf für D12 werden ebenfalls aus diesem Block gewonnen. Rolle und Name sowie beide Bedienpersonen mit „und“ bleiben zusammen. Kurze Präfixe, Hallenzusätze und Anweisungen stammen aus vollständigen Kontextaufrufen. Zwischen den fertigen Stücken liegen 250 ms Satzpause, 60 ms Verbindungspause und bei der Bedienaufforderung 120 ms nach dem wiederholten Team. Innere Pausen werden nicht nachträglich gekürzt.

Der bekannte D11-Wortlautfehler `Turnierleitungmelden!` und das auch bei Klapptafeln verwendete „Tabletbedienung“ bleiben gekennzeichnet erhalten. Der Hörsatz ändert die produktiven Vorlagen nicht. Ob die übernommenen Satzmelodien insbesondere bei Zweitaufrufen und D12 natürlich zusammenpassen, entscheidet die Hörbewertung.

### Erzeugen und erneut montieren

Im BTS-Verzeichnis mit der vorhandenen Sprachserver-Umgebung:

```bash
../bts-sprachserver/.venv/bin/python scripts/tts-match-listening.py --generate-sources
```

Der ausgegebene Pfad zu `sources.json` wird anschließend an `--assemble` übergeben. Das Zusammenbauen benötigt kein geladenes Modell:

```bash
../bts-sprachserver/.venv/bin/python scripts/tts-match-listening.py --assemble ../bts-sprachserver/data/listening-lab/match-suite/sources-8ca497a225c6/sources.json
```

Der Quellenordner hängt von Engine und Parametern ab. Die angegebenen Schnittgrenzen in `scripts/tts-match-listening-cuts.json` sind über SHA-256 an die konkreten WAVs gebunden. Abweichende Quellen werden abgelehnt. Die Grenzen wurden mit den vorhandenen lokalen Vosk-Wortzeitmarken und Signalenergie ermittelt; Erkennungsergebnisse sind keine Bestätigung der Namensaussprache. Es entsteht keine neue Laufzeitabhängigkeit der Anwendung.

Die Testdaten liegen unter `bts-sprachserver/data/listening-lab/match-suite/`. Der vorhandene Hörtest-Cache wird nur gelesen; neue Rohaufnahmen und bearbeitete Quellen erhalten eigene Dateien. Jeder Montageversuch bekommt einen neuen Ordner mit einer eigenständigen Hörseite, 32 WAVs, einzeln abspielbaren Stücken, vollständigen Kontextquellen, Herkunftsbericht und ZIP-Download. Die Hörseite kann direkt als `index.html` geöffnet oder lokal mit `python3 -m http.server 8079 --bind 127.0.0.1 --directory PFAD_ZUM_HOERSATZ` bereitgestellt werden. Suche, Gruppenauswahl und fortlaufendes Abspielen erleichtern den Vergleich.

Der erste fertige Hörsatz liegt unter `data/listening-lab/match-suite/1bfff7ef4b79/` im Sprachserver-Repository. Zwei Quellen kamen unverändert aus dem bestehenden Hörtest, zwölf wurden neu generiert. Die 32 Durchsagen umfassen zusammen etwa 4 Minuten 40 Sekunden. Alle Ausschnitte wurden samplegenau gegen ihre Quellen geprüft, alle Montagepausen und Dateihashes kontrolliert und das ZIP auf Lesbarkeit geprüft. Die vollständige Referenz bleibt bytegleich; D01 ohne Offizielle entspricht bytegleich der bisherigen Variante 6. Unpassende Quellhashes, Schnittgrenzen und Abtastraten werden abgelehnt. Ein echter Chrome spielte alle 32 WAVs vollständig ab; Gruppenauswahl und Mobilansicht mit 390 Pixeln Breite wurden geprüft. Das bestätigt die technische Wiedergabe, nicht die akustische Qualität der neuen Übergänge.

### Messanalyse, Bearbeitung und Modell-Betonung

Der [neue Vorher-Nachher-Vergleich](http://127.0.0.1:8081/) stellt die 32 bearbeiteten Fassungen ihren bisherigen Aufnahmen gegenüber. Er bereinigt eine geprüfte leise Störstelle vor „Nina“, berücksichtigt vorhandene Randstille bei den Montagepausen und hält den D12-Spielblock zusammen. Diese Änderungen verwenden vorhandene Quellen ohne neue Synthese. Zwei gezielte Modellaufnahmen ergänzen elf Vergleichsmontagen mit markierten Feldnummern beziehungsweise einer alternativen gemeinsamen Kampflos-Klausel.

Die [ausführliche Analyse](tts-audio-analyse.md) trennt Messbefunde, Nachbearbeitung, Modellversuche und noch offene Hörentscheidungen. Sie dokumentiert auch den unerwünscht mitgesprochenen Pausenmarker des zweiten Versuchs. Die vollständige experimentelle Quelle wird nicht als reguläre Durchsage verwendet; der daraus getestete Klausel-Ausschnitt endet vor dem Zusatzwort. Es gibt keine automatische Umstellung der produktiven Ansagen.
