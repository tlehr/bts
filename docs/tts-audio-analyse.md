# Messanalyse und Bearbeitung des Hörsatzes für Spiel 189

Stand: 16.10.2026 · Branch: `feat/localTts`

Der [aktuelle Hörvergleich](http://127.0.0.1:8082/) enthält die 32 Durchsagen nach den Hörkorrekturen zu D05, D08 und D12. Unter jeder Ansage ist die vorherige Fassung aus dem [ersten bearbeiteten Vergleich](http://127.0.0.1:8081/) erreichbar. Dort bleiben auch die beiden früheren Modellversuche und ihre elf Vergleichsmontagen verfügbar. Der ursprüngliche Hörsatz bleibt unter `http://127.0.0.1:8079/` erreichbar.

Die Auswertung misst Audiosignale, Randbereiche, Pegel und Montagepausen. Sie vergibt keine Hörnoten für Natürlichkeit oder Satzmelodie. Ein aktiver Rand kann eine korrekt endende Silbe sein; ein niedriger RMS-Pegel beweist keine vollständige Stille. Die automatische Worterkennung bestätigt insbesondere keine korrekte Aussprache ungewöhnlicher Namen.

## Hörkorrekturen zu D05, D08 und D12

| Stelle | Geänderte Fassung | Aufwand |
| --- | --- | --- |
| D05: „In Vorbereitung für“ | Regionales Tempo 0,88 mit FFmpeg `atempo`, bei erhaltener Tonhöhe. Das ganze Präfix dauert jetzt 2,365 statt 2,212 s. „Zweiter Aufruf“ behält sein Tempo. Das gemeinsame Präfix wird auch bei D09–D11 wiederverwendet. | Vorhandene Aufnahme bearbeiten |
| D05: vier Übergänge | Zielabstände 140 ms vor dem ersten Team, 120 ms vor dem Hallenzusatz, 320 ms vor der Teamwiederholung, 160 ms vor dem Treffpunkt. Vorhandene Randstille wird angerechnet; ohne Treffpunkt entfällt der letzte Übergang. | Keine Synthese |
| D08: nach „Klapptafelbedienung“ | 180 ms Stille in die überprüfte Wortlücke bei Quellzeit 3,610708 s eingefügt. Der lange Zweitaufruf dauert 3,937 statt 3,757 s. Alle Sprachsamples bleiben erhalten. | Vorhandene Aufnahme bearbeiten |
| D12: Ergebnissatz | „Das Spiel geht kampflos an“ aus einer vollständigen neuen Kontextaufnahme, mit Punkt vor „Das“ und Doppelpunkt nach „an“. Der bestehende vollständige Spielblock und das tatsächliche Siegerteam werden weiterverwendet. Zielabstände: 250 ms vor der Klausel, 140 ms vor dem Sieger. | Genau eine neue gemeinsame Quelle, etwa 35 s Synthese/Rendern |

Der deutsche Browsertext und die produktive deutsche lokale Textvorbereitung verwenden ebenfalls „{Team 1} gegen {Team 2}. Das Spiel geht kampflos an {Siegerteam}!“. Die Änderungen von Tempo und Pausen gelten zunächst für den festen Hörsatz. Der längere D12-Baustein ersetzt den früheren; es bleibt bei einer gemeinsamen Klausel pro Stimme. Alte Modellproben mit nur „geht kampflos an“ dürfen wegen des abweichenden Wortlauts nicht als Ersatz montiert werden.

Die neuen Tempo- und Pausenbereiche sind an die geprüften Quellhashes und Quellframes gebunden. Eine Pause wird nur in einen leisen Bereich eingefügt. Die neue D12-Klausel stammt aus 8,040–9,535 s der neuen Quelle; ihre letzten 60 ms liegen bei −56,50 dBFS RMS. Die lokale freie Worterkennung liefert „das spiel geht kampflos an“ sowie das vollständige verlangsamte Präfix und die vollständige Bedienansage. Die Klangbewertung erfolgt im Hörvergleich.

Aktueller Lauf: `259d0213c25f`, Quellen: `sources-5c4ba4f3c722`, Vergleichsbasis: `3c8a204a6b35`. Von den 14 Quellen wurden 13 aus dem Cache übernommen. Es entstehen weiterhin 31 Stücke und 32 Hauptfassungen; 16 WAVs sind bytegleich zur Vergleichsbasis.

## Befunde des ersten bearbeiteten Vergleichs

| Stelle | Vorher | Bearbeiteter Versuch | Aussage |
| --- | --- | --- | --- |
| Quellsignal vor „Nina“ | 5,245–5,400 s: −64,77 dBFS RMS; eigentlicher Wortbeginn etwa 5,43 s | Derselbe Bereich in der Wiedergabekopie: −96,71 dBFS RMS | Geprüften niederpegeligen Quellrest unterdrückt, Wortanfang außerhalb des bearbeiteten Bereichs |
| D05: Präfix → Team 1 | 255 ms gemessener leiser Abstand trotz nur 60 ms eingefügter Pause | 60 ms Zielabstand, davon 20 ms eingefügt | Bereits vorhandene leise Ränder erklären einen erheblichen Teil der Verzögerung |
| D05: Halle → wiederholtes Team 1 | 535 ms gemessener leiser Abstand | 250 ms Zielabstand, davon 170 ms eingefügt | Satzpause unter Einrechnung der Randbereiche |
| D12: Spielkopf → Begegnung | Zusätzlicher Schnitt, 250 ms Montagepause; insgesamt etwa 490 ms leiser Abstand | Vollständigen Spielblock wiederverwendet | Zusätzliche interne Montagegrenze entfällt |
| Ende von Team 1 | Letzte 60 ms: −21,38 dBFS RMS | −21,39 dBFS RMS | Trotz kurzem Fade weiterhin aktive Sprache; die Schlussbetonung ist dadurch nicht korrigiert |
| Ende von `geht kampflos an` aus der bisherigen Quelle | Letzte 60 ms: −19,14 dBFS RMS | −19,19 dBFS RMS | Die Nachbearbeitung allein macht daraus keinen natürlich abgeschlossenen Satzteil |
| Alternative gemeinsame Kampflos-Klausel | Bisheriger aktiver Rand: −19,14 dBFS RMS | Aus dem Modellversuch: −56,64 dBFS RMS | Ruhigerer Schnittrand; die freie lokale Erkennung liefert exakt `geht kampflos an`, ohne `paus` |

Die leisen Abstände verwenden 5-ms-Fenster mit einer RMS-Schwelle von −48 dBFS. Das sind reproduzierbare Signalmaße und keine phonetisch exakten Pausenlängen. Die Seiten enthalten zusätzlich sämtliche Messwerte als `analysis.json` und die lesbare Zusammenfassung als `analysis.md`.

## Bearbeitung ohne zusätzliche Sprachgenerierung

Alle 32 Hauptfassungen verwenden die vorhandenen 14 Quellen:

1. Der konkret geprüfte Quellrest vor „Nina“ wird ausschließlich in einer Kopie innerhalb des gebundenen Bereichs abgesenkt. Die Bereichsgrenzen gelten nur für den protokollierten SHA-256. Das ist kein allgemeines Rausch-Gate für unbekannte Aufnahmen.
2. Leise Außenbereiche werden vorsichtig gekürzt; vor erkannter Aktivität bleiben mindestens etwa 35 ms, danach etwa 45 ms Reserve. Maximal 300 beziehungsweise 150 ms werden entfernt. Die gewählten Schwellen können leise Konsonanten nicht semantisch erkennen und bedürfen weiterer Hörproben bei anderen Texten.
3. Aktive Ausschnittränder erhalten höchstens 5 ms Fade. Das vermindert harte Signalübergänge, verändert aber weder die Fortsetzungsbetonung eines Namens noch fehlende Phoneme.
4. Bereits vorhandene leise Ränder werden von der Zielpause abgezogen. Die zusätzliche Pause wird nie negativ. Im ersten bearbeiteten Vergleich bleiben innere Wort- und Satzpausen längerer Stücke erhalten; die gezielten aktuellen Ausnahmen sind oben beschrieben.
5. Der sehr leise Hallenzusatz wird versuchsweise um 2 dB angehoben, mit Begrenzung auf vorhandenen Spitzenpegel-Spielraum. Es gibt keine laufende Pegelautomatik innerhalb der Sprache.
6. D12 verwendet den zusammenhängenden Spielblock, danach die gemeinsame Klausel und den vorhandenen Siegerteam-Ausschnitt. Die früheren Schnitte in Spielkopf und Begegnung bleiben nur für Vergleich und Diagnose erhalten.

Die Bearbeitung ist in `scripts/tts-match-listening-optimization.json` beschrieben. Ihre Vorher-/Nachher-Messungen und jeder entfernte Rand werden protokolliert. Die alten Audiodateien und die bevorzugte vollständige Referenz werden nicht überschrieben.

## Gezielte Betonung mit dem Modell

Kitten-TTS 2 dokumentiert Hervorhebungen mit dreifachen Klammern, beispielsweise `Spielfeld (((acht)))`, sowie weitere Ausdrucksmarker. Deren Wirkung ist als experimentell beschrieben und hängt von Stimme und Satz ab. [Offizielle Modelldokumentation](https://huggingface.co/KittenML/kitten-tts-2/blob/main/README.md#expression-controls)

Der installierte native Code kennt diese Markierungen und aktiviert im offiziellen Ablauf eine zusätzliche Ausdrucksbedingung. Unser bisheriger BTS-Worker setzte diese Bedingung nicht. `scripts/tts-prosody-probe.py` erstellt deshalb einen eigenen Testworker mit derselben installierten Modell-/Stimmenbasis und dem Ausdrucksprompt `{emo: 1}` bei markiertem Text. Der produktive Worker und dessen Installation bleiben erhalten.

Zwei vollständige Kontextaufnahmen wurden erzeugt, weiterhin mit Seed 42 und den bisherigen Samplingwerten:

- **Feldnummer hervorgehoben:** Der vollständige Referenzruf markiert „acht“ am Anfang und Ende. Aus ihm stammen zwei neue Feld-Ausschnitte. Neun zusätzliche Vergleichsmontagen ersetzen ausschließlich die betreffenden Feldstücke; der übrige bearbeitete Aufbau bleibt gleich. Ob die neue Betonung dem gewünschten Hallensprecher entspricht, entscheidet die Hörbewertung.
- **Pausenmarker vor dem Sieger:** Die automatische Erkennung findet dort zusätzlich `paus`. Die vollständige Testfassung wird deshalb nicht als Verbesserung übernommen. In derselben Quelle endet das tatsächlich gesprochene „an“ vor einem ruhigen Bereich. Ein Ausschnitt von 6,985 bis 8,140 s endet vor dem erkannten Zusatzwort und liefert eine alternative gemeinsame Klausel. Zwei D12-Vergleichsmontagen verwenden sie mit den vorhandenen Siegerteam-Aufnahmen. Es wird kein neuer Siegername erzeugt.

Der zweite Versuch zeigt die Grenze der Steuerung: Ein dokumentierter Marker ist noch keine verlässlich passende deutsche Aussprache. Aus einer ungeeigneten Vollquelle kann ein geprüfter wortgleicher Ausschnitt verwendbar sein; eine allgemeine Freigabe dieses Verfahrens folgt daraus nicht.

Die zwei Quellen kosteten in diesem Versuch zusammen ungefähr 70 Sekunden einschließlich des ersten Ladens und Renderns. Die Bearbeitung der 32 Hauptfassungen benötigte null zusätzliche Modellaufrufe. Bei einer späteren Übernahme würde ein geeignetes neues Quellmuster die bisherige Feld- beziehungsweise Kampflos-Referenz ersetzen. Dafür entstehen im leeren Cache weiterhin eine Referenz je Feld und eine gemeinsame Kampflos-Quelle, keine zusätzlichen Generierungen je Team. Ein Wechsel des Quellmusters benötigt einmalig dazu passende Cache-Dateien.

## Wiederholen

Quellen des ursprünglichen Hörsatzes und sämtliche neuen Daten liegen im Sprachserver-Repository unter `data/listening-lab/match-suite/`. Der ursprüngliche Lauf heißt `1bfff7ef4b79`, der bearbeitete Vergleich `3c8a204a6b35`; die Modellproben liegen unter `prosody/8c444dc62ec8/`.

Im BTS-Verzeichnis für den aktuellen Stand:

```bash
../bts-sprachserver/.venv/bin/python scripts/tts-match-listening.py --analyze ../bts-sprachserver/data/listening-lab/match-suite/1bfff7ef4b79

../bts-sprachserver/.venv/bin/python scripts/tts-match-listening.py --generate-sources

../bts-sprachserver/.venv/bin/python scripts/tts-match-listening.py --assemble ../bts-sprachserver/data/listening-lab/match-suite/sources-5c4ba4f3c722/sources.json --optimization scripts/tts-match-listening-optimization.json --baseline ../bts-sprachserver/data/listening-lab/match-suite/3c8a204a6b35

../bts-sprachserver/.venv/bin/python -m pytest -q -o cache_dir=/tmp/bts-audio-pytest-cache test/test_tts_match_audio.py
```

Der Modellproben-Worker schreibt nur seinen eigenen Build und seine Testdateien. Wiederholte Modellproben verwenden deren passenden Cache. Die Montage lädt kein Sprachmodell. Veränderungen von Stimme, Modell, Parametern oder Quelle benötigen neue geprüfte Schnittgrenzen; vorhandene Zeiten werden nicht blind übertragen.

## Technische Prüfung

Aktueller Stand: Neun DSP-Tests sowie 33 Text- und echte FastAPI/Chrome-Integrationstests bestanden. Die neuen Tests sichern die unveränderten Samples neben einer eingefügten Pause, die Tonhöhe beim regionalen Verlangsamen, den neuen D12-Browsertext für beide Sieger und dessen Cache-Vorbereitung ab. Alle 32 aktuellen Montagen wurden samplegenau rekonstruiert; Quellen und Vergleichskopien behalten ihre Hashes, die WAVs übersteuern nicht und das ZIP ist lesbar. Ein separater Chrome spielte alle 32 neuen Hörproben vollständig ohne Audiofehler ab; Filter und Mobilansicht mit 390 Pixeln Breite wurden geprüft.

Erster bearbeiteter Vergleich:

Sechs DSP-Tests bestanden: Sie prüfen den Schutz der Originaldaten und benachbarter Wörter, die Bindung an Quellhashes, den Erhalt des Sprachsignals bei Randkürzung und kurzen Fades sowie die Anrechnung vorhandener Stille. Alle 32 bearbeiteten WAVs und elf zusätzlichen Montagen wurden samplegenau aus ihren protokollierten Stücken und Pausen rekonstruiert. Quellen und Vorher-Dateien behalten ihre Hashes, die neuen WAVs bleiben innerhalb des vorgesehenen Spitzenpegels und das ZIP ist lesbar. Ein echter Chrome spielte diese 43 Montagen und beide vollständigen Modellproben ab; Filter und Mobilansicht mit 390 Pixeln Breite wurden geprüft. Die ungezwungene lokale Erkennung des alternativen Klausel-Ausschnitts liefert `geht kampflos an`. Diese Prüfungen bestätigen die technische Bearbeitung, nicht eine subjektiv bessere Sprachmelodie.
