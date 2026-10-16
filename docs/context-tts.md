# Kontextbasierte Turnierdurchsagen

Stand: 16.10.2026 · Branch: `feat/localTts`

Der in [unserem Arbeitsdokument](durchsagen-arbeitsdokument.md) vereinbarte Aufbau wird jetzt für die deutsche lokale Sprachausgabe verwendet, wenn der Sprachserver `context_version: bts-context-v1` meldet. Browser-TTS behält seine bisherigen zusammenhängenden Texte. Anwesenheitskontrolle, freie Texte und Sprachtest bleiben eigenständig.

## Quellen und wiederverwendete Stücke

- Für jedes aktive Feld wird ein vollständiger fester Referenzaufruf erzeugt. Daraus kommen getrennte Anfangs- und Schlussaufnahmen von „Auf Spielfeld …!“. Die Feldquelle hängt nicht vom tatsächlichen Spiel ab.
- Ein Spiel mit zwei feststehenden vollständigen Teams erhält einen zusammenhängenden Spielblock. Aus derselben Aufnahme werden beide vollständigen Teams ohne „gegen“ ausgeschnitten. Feld und Offiziellen-Zuordnung verändern diesen Block nicht.
- Eine vollständige normale Zweitaufruf-Quelle je Rollen-/Namenszuordnung liefert den langen Aufruf, Rolle mit Name und gegebenenfalls den Namen allein. Doppel- und Bedien-Teams behalten ihr „und“.
- Hallen-, Treffpunkt-, Präfix- und Anweisungstexte stammen aus vollständigen Beispielaufrufen. Identische Quellen werden gemeinsam genutzt. D12 verwendet den vollständigen Spielblock, einmal „Das Spiel geht kampflos an“ und das tatsächliche Siegerteam.

Für B01 benötigen `F` Felder und `S` bekannte Spiele also `F` feste Feldreferenzen und `S` Spielquellen, keine `F × S` vollständigen Spielaufrufe. Der Spielblock mit Nummer 189 in jeder Feldreferenz ist immer derselbe feste Beispieltext. Er wird nur für die Sprachmelodie mitgesprochen und beim Ausschneiden des Feldanfangs und Feldendes verworfen. Bei der späteren Feldzuweisung wählt BTS die beiden fertigen Feldstücke aus und setzt den tatsächlichen Spielblock dazwischen; dafür entsteht kein weiterer Sprachserver-Auftrag.

`speech_context.js` plant die Ausschnitte gemeinsam für Browser, Bereitschaftsanzeigen und Backend. Seine internen Beschreibungen bleiben in der Übertragung; die Einstellungen zeigen die lesbaren Zieltexte. Zahlen bleiben dort Ziffern und werden erst vor der Anfrage an den Sprachserver ausgeschrieben.

## Reihenfolge und Cache

Zuerst kommen die Feldaufnahmen für alle aktiven Felder und B12. Anschließend werden die nahen Aufrufe einschließlich fehlender Hallen-/Offiziellen-Teile vervollständigt. Die regulären Spielblöcke folgen ihrer Spielnummer. Weitere Spiele mit bekannten Teams werden ebenfalls vorgemerkt; die Zahl der nahen Spiele steuert `prefetch_matches`, die Gesamtvormerkung bleibt durch `max_entries` begrenzt (Standard jetzt 4096).

BTS legt Quellen vor ihren abhängigen Ausschnitten an und schickt weiterhin nur einen offenen Auftrag. Ein Ausschnitt ist ein kurzer Verarbeitungsauftrag, keine zusätzliche Sprachsynthese. Aktuelle Aufrufe erhöhen auch die Priorität ihrer fehlenden Quelle; eine laufende Arbeit wird fertiggestellt. Die gemeinsame Warteschlange, Fortschritt, Abschlussereignisse und Lautsprecher-Proben bleiben erhalten. Quellzeilen unterscheiden „Feldreferenz“, „Spielblock · einmal pro Spiel“ und „Gemeinsame Kontextaufnahme“. Die Zusammenfassung zählt Feldreferenzen und Spielblöcke getrennt. Der Fortschritt zählt Quellen und Schnitte, nicht allein Modellaufrufe.

Der Sprachserver speichert Quellen und Ausschnitte als unveränderliche WAVs im bestehenden Cache. Quellen verwenden Seed 42; ihre Schlüssel berücksichtigen weiterhin Stimme, Modell, Referenz und Sampling. Die Ausschnittschlüssel enthalten zusätzlich die konkrete Quellaufnahme, den exakten Textbereich, das Erkennungsmodell und die Verarbeitungsversion. Änderungen der Schnittverarbeitung benötigen keine neue Sprachsynthese der Quelle. Alte Aufnahmen werden nicht überschrieben.

## Tempo, Pausen und Wiedergabe

- Der Hallensprecher erhält insgesamt Tempo 1,155, die Hallensprecherin 1,05. Der Client rechnet seine Turniereinstellung relativ zum bisherigen Standard 1,05 dazu; er beschleunigt vorbereitete Aufnahmen nicht nochmals um den früheren Männerfaktor.
- „In Vorbereitung für“ im gemeinsamen Präfix wird beim Hallensprecher mit Faktor 0,88 verlangsamt; „Zweiter Aufruf“ behält sein Tempo.
- D05 nutzt Zielpausen von 140/120/320/160 ms. Leere Bestandteile entfallen. D08 erhält nach „Klapptafelbedienung“ zusätzlich 180 ms innerhalb des langen Aufrufs.
- D12 setzt vor „Das Spiel geht kampflos an“ 250 ms Zielabstand, vor dem Siegerteam 140 ms. Der deutsche Browsertext verwendet denselben neuen Ergebnissatz.

Vorhandene leise Ränder zählen zur Zielpause. Am Standardtempo dekodiert ein freigegebener Web-Audio-Client alle fertigen Teile vor dem Start und plant sie auf einer gemeinsamen Audio-Uhr. So verlängert der Abruf der nächsten WAV die Verbindung nicht. Bei abweichender Turniergeschwindigkeit oder ohne laufende Audio-Uhr bleibt der vorhandene HTML-Audio-Pfad mit erhaltener Tonhöhe verfügbar. Audio muss weiterhin einmal pro Browser freigegeben werden.

## Automatische Schnitte

Vosk arbeitet lokal mit dem gepinnten kleinen deutschen Modell. Pro Quelle werden Wortzeitmarken einmal ermittelt und gecacht. Aus dem exakten Quelltext und den erkannten benachbarten Wörtern werden individuelle Grenzen abgeleitet. Stille und nahe Nulldurchgänge verfeinern sie. Bei fließend verbundenen Wörtern kann ein energietragender Rand bleiben; dafür gibt es kurze Fades. Ohne hinreichende Wortanker wird kein Ausschnitt veröffentlicht und kein kurzer Ersatztext synthetisiert. Im Automatikmodus bleibt dann der sichtbare Browser-Fallback verfügbar.

Die festen Frame-Grenzen und die einmalige Rauschkorrektur des Hörversuchs werden nicht auf unbekannte Turnieraufnahmen übertragen. Schnittprotokolle liegen im Sprachserver unter `data/alignment/*.cut.json` mit Quellhash, Wortmodell, Frames und Randpegeln. Automatische Worterkennung und technische Abspieltests ersetzen keine Klangabnahme ungewöhnlicher Namen.

## Aktivieren und prüfen

Im Sprachserver einmal `bash scripts/install-context.sh` ausführen; für die Modellinstallation kann `--archive /pfad/vosk-model-small-de-0.15.zip` verwendet werden. Danach Sprachserver und BTS neu starten und Clientseiten neu laden. `/health` muss `context_version: bts-context-v1` melden. Fehlt die optionale Erkennung, bietet der Server die neue Strategie nicht an; alte Server und Browser-TTS bleiben kompatibel. `BTS_CONTEXT_ENABLED=false` schaltet diese Strategie serverseitig ab.

Die vorhandene Turnierauswahl von Stimme und Sprachmodus gilt weiterhin für alle Clients. Nur diese ausgewählte lokale Stimme wird vorbereitet. Der neue Kontextbestand wird vorab aufgebaut; noch unvollständige Aufrufe werden weiterhin als solche angezeigt.

## Validierung

103 Sprachserver-Tests bestanden, die beiden bisherigen teuren Modelltests blieben opt-in. 137 BTS-Sprachtests einschließlich FastAPI und echtem Chrome bestanden; ESLint meldet für die geänderten JavaScript-Dateien keine Fehler. Neue Tests vergleichen sämtliche gesprochenen Wörter und Browsertexte über optionale Turniereinstellungen hinweg, prüfen die vollständige Vorabplanung, Quellabhängigkeiten, Cache-Wiederverwendung und die gemeinsame Audio-Uhr.

Ein zusätzlicher Regressionstest bereitet drei Spiele ohne Feldzuweisung und alle 13 Feldreferenzen vor. Anschließend ruft er acht B01-basierte Ansagearten für jedes Spiel auf jedem Feld ab. Alle Stücke sind bereits fertig; weder eine weitere Quelle noch ein Ausschnitt oder ein zusätzlicher Sprachserver-Auftrag wird angelegt.

Der separate Durchlauf `bts-sprachserver/data/integration/context/cdaa5732dbfe/` bereitete alle 32 Varianten des Beispielspiels über den echten BTS-Adapter vor: 14 Kontextquellen und 30 Ausschnitte sowie ein separater Sprachtest, keine fehlgeschlagenen Aufträge. Passende vorhandene Kitten-Rohaufnahmen wurden nur gelesen, fehlende Quellen mit dem nativen Worker erzeugt. Ein echter Chrome spielte D01 ohne Offizielle, D05, D08/Klapptafel und D12 mit beiden Siegern über die neue Audio-Uhr vollständig ab, ohne Browser-Fallback oder JavaScript-Fehler.
