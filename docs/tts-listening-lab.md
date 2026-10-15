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

| Fassung | Zweck |
| --- | --- |
| Am Stück | Zusammenhängende Referenz mit dem vollständigen vorgegebenen Text und seinen Satzzeichen |
| Bisherige Bausteine | Bisherige Texte ohne abschließende Satzzeichen, Namen und „gegen“ getrennt |
| Mit Satzzeichen | Feld/Runde mit Ausrufezeichen, Spiel/Disziplin mit Punkt, beide Namen mit neutralem Komma |
| Namen zusammen | Wie oben; beide Namen mit „gegen“ als gemeinsamer Satz statt drei einzelner Aufnahmen |

Die wiederholte Feldansage verwendet jeweils dieselbe Aufnahme. Die drei Bausteinfassungen werden alle mit derselben neuen Montage verarbeitet; die zweite Fassung bildet die bisherige **Textstückelung**, nicht zusätzliche variable Ladepausen des produktiven Browsers ab. Namen bekommen in der dritten Fassung dieselbe Kommaform unabhängig von ihrer Position. Das ist eine Hörtest-Variante, keine bereits freigegebene Betonungsregel für das Turnier.

## Einstellungen ohne Modellneustart vergleichen

Zunächst wird der Hallensprecher mit Temperatur 0,8, Top-k 50, Top-p 0,8 und Seed 42 erzeugt. Diese Werte gelten für alle Teile und Fassungen des Vergleichs. Die männliche Standardgeschwindigkeit 1,155 entspricht dem aktuellen BTS-Standard einschließlich seiner zusätzlichen zehn Prozent.

- **Pausen und Tempo:** vorhandene Testaufnahmen werden wiederverwendet. FFmpeg verändert je Clip das Tempo bei erhaltener Tonhöhe; danach werden feste Satz-/Verbindungspausen eingefügt. Es ist keine neue Inferenz erforderlich.
- **Temperatur, Top-k, Top-p und Seed:** fehlende Kombinationen werden neu generiert. Derselbe native Prozess hält Modell und Decoder dabei geladen. Für den nächsten Vergleich beispielsweise nur die Temperatur auf 0,6 setzen; alle übrigen Werte bleiben gleich.
- **Stimme:** beide eigenen Stimmen stehen bereit. Der Wechsel setzt im Formular das Standardtempo auf 1,155 beziehungsweise 1,05. Die Stimme gehört zum getrennten Test-Cache.
- **Zeichensetzung/Stückelung:** Änderungen des Plans erzeugen nur neue Sprechtexte. Unveränderte Bausteine und wiederholte Feldansagen werden weiterverwendet.

Vor der Montage nutzt der Hörtest die BTS-Kürzung langer nahezu stiller Wortlücken bei atomaren Bausteinen. Vollständige Referenz- und Namenssätze behalten ihre inneren Modellpausen. Nach der Tempoänderung werden stille Ränder bei der konservativen PCM16-Schwelle vier entfernt; zwischen den Clips liegen dann die eingestellten 250 ms Satzpause beziehungsweise 60 ms bei Namen/„gegen“. Jede komplette Hörprobe erhält 30 ms äußere stille Reserve. Die am Stück erzeugte Referenz behält ihre inneren Modellpausen. Rein stille Testausgaben werden nicht als Sprache zugeschnitten.

Jeder Durchlauf erzeugt vier eigenständige WAVs und einen JSON-Bericht mit Original-/Sprechtexten, tatsächlichen Bausteinen, Parametern, Seed, Worker-PID, Cache-Treffern, Generierungszeiten und Dateihashes. Rohaufnahmen werden nicht überschrieben. Neue Resultate erscheinen über den bisherigen Resultaten, sodass Einstellungen direkt vergleichbar bleiben. Ein fester Seed macht unterschiedliche Texte nicht automatisch gleich betont; die Hörprobe entscheidet über die Qualität.

Der Dienst bindet ausschließlich an `127.0.0.1`; ein Vergleich läuft zur Zeit. Fremde Host-/Origin-Anfragen werden abgelehnt. Mit `Strg+C` wird nur der Hörtest samt seinem eigenen Worker beendet. Nach einem Neustart bleiben die Test-WAVs und Berichte erhalten; das Modell wird einmal neu geladen. Änderungen an der produktiven Ansage werden erst nach Auswertung dieses Vergleichs übernommen.

## Erste Ausführung

Der echte Kitten-Worker erzeugte die 15 unterschiedlichen männlichen Aufnahmen mit Temperatur 0,8 und Seed 42 in insgesamt etwa 207 Sekunden Inferenzzeit. Bei Tempo 1,155 und Pausen 250/60 ms dauern die vier fertigen Fassungen etwa 11,68 / 16,67 / 16,43 / 15,79 Sekunden. Das ist eine Messung dieses Durchlaufs, keine Qualitätsrangfolge. Die WAVs und der vollständige Bericht liegen unter `bts-sprachserver/data/listening-lab/de27c91aa9b9/`.

Ein echter Chrome spielte die dritte WAV nativ vollständig ab; Desktop- und Mobilansicht wurden geprüft. Eine Änderung der Satzpause auf 300 ms erzeugte anschließend **null** neue Clips, verwendete dieselben Roh-WAV-Hashes und behielt Worker-PID 2305824. Der zweite Bericht liegt unter `data/listening-lab/5790056a3920/`. Die einzelnen Testordner werden beim Commit nicht eingecheckt. Zusätzlich bestanden 16 gezielte BTS-Tests sowie alle 91 regulären Sprachserver-Tests; zwei sonstige CPU-Integrationstests blieben ausdrücklich deaktiviert. Die akustische Bewertung der vier Varianten erfolgt durch den Betreiber.
