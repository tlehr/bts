# Kontextbasierte Turnierdurchsagen

Historische v1-Beschreibung · Stand: 16.10.2026

**Aktuell läuft Kontext v2 auf `feat/localTts`.** Der aktuelle Bausteinaufbau,
die Prioritäten und die Aktivierung stehen in [Kontext v2 im BTS](context-v2-production.md).
Die folgenden v1-Details bleiben zur Nachvollziehbarkeit erhalten.

Der in [unserem Arbeitsdokument](durchsagen-arbeitsdokument.md) vereinbarte Aufbau wird jetzt für die deutsche lokale Sprachausgabe verwendet, wenn der Sprachserver `context_version: bts-context-v1` meldet. Browser-TTS behält seine bisherigen zusammenhängenden Texte. Anwesenheitskontrolle, freie Texte und Sprachtest bleiben eigenständig.

## Quellen und wiederverwendete Stücke

- Für jedes aktive Feld wird ein vollständiger fester Referenzaufruf erzeugt. Daraus kommen getrennte Anfangs- und Schlussaufnahmen von „Auf Spielfeld …!“. Die Feldquelle hängt nicht vom tatsächlichen Spiel ab.
- Ein Spiel mit zwei feststehenden vollständigen Teams erhält einen zusammenhängenden Spielblock. Aus derselben Aufnahme werden beide vollständigen Teams ohne „gegen“ ausgeschnitten. Feld und Offiziellen-Zuordnung verändern diesen Block nicht.
- Eine vollständige normale Zweitaufruf-Quelle je Rollen-/Namenszuordnung liefert den langen Aufruf, Rolle mit Name und gegebenenfalls den Namen allein. Doppel- und Bedien-Teams behalten ihr „und“.
- Bei aktivierter Tabletbedienung werden die Rollen-/Namensblöcke für **beide möglichen Teams** schon vor der Bedienerzuweisung vorbereitet. Beim Spielaufruf wird nur der passende fertige Block ausgewählt. Eine feste Zweitaufruf-Referenz pro unterschiedlich benanntem Bedienerteam liefert „Tabletbedienung: …“ bzw. „Klapptafelbedienung: …“, den langen Zweitaufruf und die Namen. Sie hängt weder vom später bedienten Spiel noch vom tatsächlich zugewiesenen Feld ab; dieselben Teams teilen ihre Aufnahme über mehrere Spiele hinweg. Bei aufgeteilten Doppeln werden die einzelnen Spieler vorbereitet, bei aktivierten Dienstbezeichnungen die tatsächlich verwendeten Bezeichnungen.
- Hallen-, Treffpunkt-, Präfix- und Anweisungstexte stammen aus vollständigen Beispielaufrufen. Identische Quellen werden gemeinsam genutzt. D12 verwendet den vollständigen Spielblock, einmal „Das Spiel geht kampflos an“ und das tatsächliche Siegerteam.

Für B01 benötigen `F` Felder und `S` bekannte Spiele also `F` feste Feldreferenzen und `S` Spielquellen, keine `F × S` vollständigen Spielaufrufe. Der Spielblock mit Nummer 189 in jeder Feldreferenz ist immer derselbe feste Beispieltext. Er wird nur für die Sprachmelodie mitgesprochen und beim Ausschneiden des Feldanfangs und Feldendes verworfen. Bei der späteren Feldzuweisung wählt BTS die beiden fertigen Feldstücke aus und setzt den tatsächlichen Spielblock dazwischen; dafür entsteht kein weiterer Sprachserver-Auftrag.

`speech_context.js` plant die Ausschnitte gemeinsam für Browser, Bereitschaftsanzeigen und Backend. Seine internen Beschreibungen bleiben in der Übertragung; die Einstellungen zeigen die lesbaren Zieltexte. Zahlen bleiben dort Ziffern und werden erst vor der Anfrage an den Sprachserver ausgeschrieben.

## Fiktive Namen in gemeinsamen Kontexten

Die festen Beispiel- und Kontextquellen verwenden Max Mustermann, Hans Dampf
sowie Erika Musterfrau und Otto Normalverbraucher. Diese Namen sind fiktive
Platzhalter für die Sprachmelodie. Tatsächliche Team- und Offiziellennamen werden
weiterhin aus den jeweiligen Turnierdaten übernommen.

Geänderte Kontexttexte bekommen neue Cache-Schlüssel und werden gegen ihre neue
Aufnahme geschnitten. Bereits gespeicherte Audio- und Laboraufnahmen werden durch
die Änderung der Vorlagen nicht gelöscht oder umbeschriftet.

## Reihenfolge und Cache

Beide Teams, die gerade auf einem Feld spielen (`oncourt` mit Feldzuweisung), werden als mögliche nächste Tabletbediener mit normaler Priorität vorbereitet. Nur angesetzte oder in Vorbereitung befindliche Teams erzeugen keine zusätzlichen möglichen Tabletrollen. Zusätzlich liest BTS die gespeicherte Warteliste der Bediener; deren noch offene Dienstgruppen werden vor den laufenden Spielen mit normaler Priorität vorbereitet, auch wenn das zugehörige Spiel schon beendet ist oder BTS neu gestartet wurde. Bereits beendete Dienste erzeugen keine zusätzliche Vorbereitung. Die beiden möglichen Gruppen erhalten keine echten Bedienerzuweisungen durch diese Planung. Tatsächliche Zuordnung und Ansagetexte bleiben unverändert. Nach jeder Vorabplanung entfallen nicht mehr benötigte Hintergrundaufträge aus der Warteschlange. Ein bestätigtes Spielende löst dies auch über das tatsächliche `score`-Ereignis aus; normale Punkte lösen keine zusätzliche Planung aus. Eine ausdrücklich angeforderte Kontextansage bleibt zehn Sekunden geschützt und wird danach ebenfalls entfernt, falls sie nicht mehr benötigt wird. Freie Texte und Aufträge anderer Turniere bleiben erhalten; ein laufender Auftrag wird abgeschlossen, fertige Dateien bleiben im dauerhaften Cache.

Zuerst kommen die Feldaufnahmen für alle aktiven Felder und B12. Anschließend werden die nahen Aufrufe einschließlich fehlender Hallen-/Offiziellen-Teile vervollständigt. Die regulären Spielblöcke folgen ihrer Spielnummer. Weitere Spiele mit bekannten Teams werden ebenfalls vorgemerkt; die Zahl der nahen Spiele steuert `prefetch_matches`, die Gesamtvormerkung bleibt durch `max_entries` begrenzt (Standard jetzt 4096).

BTS legt Quellen vor ihren abhängigen Ausschnitten an und schickt weiterhin nur einen offenen Auftrag. Ein Ausschnitt ist ein kurzer Verarbeitungsauftrag, keine zusätzliche Sprachsynthese. Aktuelle Aufrufe erhöhen auch die Priorität ihrer fehlenden Quelle; eine laufende Arbeit wird fertiggestellt. Die gemeinsame Warteschlange, Fortschritt, Abschlussereignisse und Lautsprecher-Proben bleiben erhalten. Quellzeilen unterscheiden „Feldreferenz“, „Spielblock · einmal pro Spiel“ und „Gemeinsame Kontextaufnahme“. Die Zusammenfassung zählt Feldreferenzen und Spielblöcke getrennt. Der Fortschritt zählt Quellen und Schnitte, nicht allein Modellaufrufe.

Vorbereitungsanfang und Vorbereitungsabschluss sind Ausschnitte mit unterschiedlicher Satzposition und Sprachmelodie. Die Anzeige kennzeichnet diese als „Anfang · Ausschnitt“ und „Ende · Ausschnitt“. Leere oder nur aus Leerzeichen bestehende Hallenzusätze erzeugen keine zusätzlichen Fassungen. Ohne aktivierten Treffpunkt oder bei leerem Treffpunkttext lautet der D02-Abschluss jetzt wie im Browser `Das Spiel ist in Vorbereitung!`. Die Referenzaufnahme enthält diesen vollständigen Abschluss; Anfang und Ende ohne zugewiesenes Feld können dadurch dieselbe Quelle teilen. Ein ungenutzter Treffpunkttext verändert diese Quelle nicht.

Der Sprachserver speichert Quellen und Ausschnitte als unveränderliche WAVs im bestehenden Cache. Quellen verwenden Seed 42; ihre Schlüssel berücksichtigen weiterhin Stimme, Modell, Referenz und Sampling. Die Ausschnittschlüssel enthalten zusätzlich die konkrete Quellaufnahme, den exakten Textbereich, das Erkennungsmodell und die Verarbeitungsversion. Änderungen der Schnittverarbeitung benötigen keine neue Sprachsynthese der Quelle. Alte Aufnahmen werden nicht überschrieben.

### Dauerhafter BTS-Cache und gemeinsamer Audiospeicher

BTS speichert fertige Quellen und Ausschnitte zusätzlich dauerhaft unter `data/speech-cache/`. Der atomar geschriebene Index enthält die genaue Zuordnung zu Baustein, Stimme, Sprache und bestätigter Synthesekonfiguration sowie WAV-Prüfsumme und Wiedergabemerkmale. Der Fertigstatus wird erst nach Prüfung und Synchronisierung von Datei und Index veröffentlicht. Beim Neustart werden Dateien geprüft und passende Zuordnungen wiederhergestellt, ohne diese Bausteine erneut beim Sprachserver anzumelden. Fehlende oder beschädigte Dateien werden nicht als fertig angezeigt. Eine bestätigte Modell-, Stimm- oder Verarbeitungsänderung verwendet die dazu passende eigene Zuordnung.

Laufen beide Dienste auf demselben Dateisystem, kann `speech.shared_audio_dir` in der BTS-Konfiguration auf das `data/audio/` des Sprachservers zeigen. BTS legt dann eigene **Hardlinks** an: zwei Dateinamen, dieselben WAV-Daten auf der Festplatte. Die eigenen Links erhalten den fertigen Bestand auch bei abgeschaltetem Sprachserver. Bereits heruntergeladene Kopien werden beim Start auf Hardlinks umgestellt, wenn die passende unveränderte Quelldatei verfügbar ist. Über Dateisystemgrenzen hinweg wird stattdessen kopiert; bei einem entfernten Sprachserver werden fertige Dateien einmalig über die geschützte Audio-API heruntergeladen.

Die SQLite-Datenbank des Sprachservers und der BTS-Index bleiben getrennt. BTS verändert keine Sprachserver-Datei und schreibt nicht in dessen Datenbank. Die Sprachserver-Bereinigung erhält WAVs mit zusätzlichen Hardlinks, damit ihre Quell-IDs auch für spätere Ausschnitte verfügbar bleiben. Ist das konfigurierte Sprachserver-Cachelimit durch geschützte Dateien ausgeschöpft, wird weiterer Platz benötigt oder das Limit muss erhöht werden; fertige geteilte Aufnahmen werden dafür nicht gelöscht. BTS entfernt seinen gesicherten Bestand nicht automatisch.

Beispiel innerhalb von `speech` in der BTS-`config.json`:

```json
{
  "cache_enabled": true,
  "cache_dir": "data/speech-cache",
  "shared_audio_dir": "/pfad/zum/bts-sprachserver/data/audio"
}
```

Alternativ gelten `BTS_SPEECH_CACHE_ENABLED`, `BTS_SPEECH_CACHE_DIR` und `BTS_SPEECH_SHARED_AUDIO_DIR`. Der Standard ist ein eigener Cache neben dem dateibasierten BTS-Datenbestand; `shared_audio_dir` ist standardmäßig leer. Die Dienste benötigen Zugriff auf den angegebenen Audiopfad. Jeder BTS-Datenbestand behält seinen eigenen Index; gemeinsam genutzt werden die unveränderlichen WAV-Daten. Der Cache enthält keine API-Schlüssel und wird mit privaten Verzeichnis-/Indexrechten angelegt.

Fertige Aufnahmen werden direkt durch den vorhandenen signierten BTS-Audiopfad ausgeliefert, einschließlich Bereichsanfragen. Das funktioniert auch nach einem BTS-Neustart mit gestopptem Sprachserver; nur fehlende Bausteine benötigen dessen Rückkehr. Die Bereitschaftsanzeige berücksichtigt diese lokale Verfügbarkeit. Die Einstellungen nennen zusätzlich, wie viele Aufträge dauerhaft im BTS gespeichert sind.

Der BTS-Cache wird vor der Aufnahme eines Bausteins als offene Arbeit und nochmals vor dem Versand einer wartenden Anfrage geprüft. Beim Start wartet die Verarbeitung auf die Dateiprüfung. Ein fertiger Ausschnitt bleibt unabhängig von seiner Rohquelle abspielbar; eine fehlende Quelldatei wird nicht allein für dessen Wiedergabe neu erzeugt. Bei einem BTS-Cachemiss prüft der Sprachserver im vorhandenen `/v1/speech`-Aufruf seinen eigenen Cache, bevor er neue Sprache berechnet.

### Anzeige der Aufträge

Jede Zeile zeigt ihre Auftragsart ausdrücklich an:

| Anzeige | Was passiert? |
| --- | --- |
| **Sprachaufnahme erzeugen** | Der vollständige angezeigte Text wird synthetisiert oder als vorhandene Aufnahme aus dem Cache übernommen. |
| **Aus Aufnahme ausschneiden** | Der angezeigte Baustein wird aus der genannten Quellaufnahme geschnitten. Das Sprachmodell wird dafür nicht erneut aufgerufen. |
| **Aufnahme aufbereiten** | Die vollständige vorhandene Aufnahme wird für die Wiedergabe bearbeitet, etwa das Tempo eines Spielblocks. Dafür entsteht keine neue Sprachsynthese. |

Quellen erhalten in der geöffneten Listenansicht eine Kennung wie „Aufnahme A17“. Ihre aufklappbare Liste „Liefert … Bausteine“ zeigt die vorgemerkten Ergebnisse. Jeder Verarbeitungsauftrag verweist auf seine Quelle; ein Klick auf „Aus Aufnahme A17“ springt zur zugehörigen Zeile. Bei Ausschnitten lässt sich der vollständige Originaltext aufklappen, darin ist die übernommene Stelle markiert. Die beiden „In Vorbereitung“-Zeilen zeigen deshalb dieselbe Aufnahme, aber unterschiedliche markierte Positionen.

Wartet ein Ausschnitt auf seine noch unfertige Quelle, wird diese Abhängigkeit ausdrücklich angezeigt. Laufende Aufträge heißen je nach Art „Sprachaufnahme wird erzeugt“, „Wird ausgeschnitten“ oder „Wird aufbereitet“. Die Zusammenfassung der Warteschlange zählt weiterhin tatsächliche Aufträge einschließlich Rohaufnahmen und Verarbeitung. Die A-Kennung einer Aufnahme und die wechselnde Warteschlangenposition links haben verschiedene Aufgaben.

Darunter stehen ein Gesamtbalken und Balken für D01–D14. Sie zeigen wiederverwendbare Wiedergabebausteine für die ausgewählte Stimme und Synthesefassung dieses Turniers. Dieselben Bausteine dürfen mehreren Aufrufarten dienen; der Gesamtbalken zählt ihre Vereinigung, keine Summe der Einzelbalken. Ein Spiel mit noch unbekannten Teilnehmern erhält vorläufig einen gemeinsamen grauen Platzhalter. Auch gemeldete Personen aller Disziplinen, bekannte Paarungen und Offizielle werden als mögliche spätere Aufrufe erfasst. Identische Bausteine derselben Person werden dabei über Disziplinen hinweg zusammengefasst; unterschiedliche Einzahl- und Paarungsfassungen bleiben eigene Texte. Die Aufrufarten lassen sich gemeinsam ein- und ausklappen. D15 verwendet eine vorhandene MP3 und benötigt keine Sprachgenerierung.

| Farbe | Bedeutung |
| --- | --- |
| Blau | Aufnahme vorhanden, derzeit kein Bedarf in der BTS-Warteschlange |
| Dunkelgrün | Benötigter Baustein aus vorhandenem Cache |
| Hellgrün | Benötigter Baustein, für dieses Turnier neu erzeugt oder aufbereitet |
| Orange | Beauftragt, noch nicht fertig; auch offene fehlgeschlagene Aufträge mit zusätzlichem rotem Fehlerzähler |
| Grau | Bekannter möglicher Baustein oder unbekanntes Spiel, noch ohne Aufnahme und ohne Auftrag |

Der graue Bestand erzeugt keine Sprachaufträge. Die Vorbereitung verwendet unverändert die vorhandene Auswahl und Reihenfolge. Ihre Bereitschaftsquote zählt nur Grün und Orange. Fällt der Bedarf an einer fertigen Aufnahme weg, wandert sie nach Blau. Der Sprachserver meldet mit `cache_hit`, ob eine fertige Aufnahme wiederverwendet wurde; bestehende BTS-Aufnahmen gelten ebenfalls als Cache. Zuordnung zu Aufrufarten und Ursprung neuer Aufnahmen werden im BTS-Index mitgespeichert und überleben einen Neustart. Bereits angenommene neue Generierungen erhalten dafür vor ihrem Abschluss eine gespeicherte Herkunftsmarkierung. Ältere Cacheeinträge erhalten ihre Zuordnung beim nächsten Vergleich mit den bekannten Turniertexten.

Eine separate Anzeige „Dauerhaft im BTS-Cache“ zählt alle geprüften gespeicherten Zuordnungen einschließlich anderer Turniere, Stimmen und Synthesefassungen. Dieser Bestand bleibt beim Entfernen von Aufträgen und nach Neustarts erhalten; während der Dateiprüfung wird noch keine Teilzahl angezeigt.

## Tempo, Pausen und Wiedergabe

- Der Hallensprecher erhält insgesamt Tempo 1,155, die Hallensprecherin 1,05. Der Client rechnet seine Turniereinstellung relativ zum bisherigen Standard 1,05 dazu; er beschleunigt vorbereitete Aufnahmen nicht nochmals um den früheren Männerfaktor.
- „In Vorbereitung für“ im gemeinsamen Präfix wird beim Hallensprecher mit Faktor 0,88 verlangsamt; „Zweiter Aufruf“ behält sein Tempo.
- D05 nutzt Zielpausen von 140/120/320/160 ms. Leere Bestandteile entfallen. D08 erhält nach „Klapptafelbedienung“ zusätzlich 180 ms innerhalb des langen Aufrufs.
- D12 setzt vor „Das Spiel geht kampflos an“ 250 ms Zielabstand, vor dem Siegerteam 140 ms. Der deutsche Browsertext verwendet denselben neuen Ergebnissatz.

Vorhandene leise Ränder zählen zur Zielpause. Am Standardtempo dekodiert ein freigegebener Web-Audio-Client alle fertigen Teile vor dem Start und plant sie auf einer gemeinsamen Audio-Uhr. So verlängert der Abruf der nächsten WAV die Verbindung nicht. Bei abweichender Turniergeschwindigkeit oder ohne laufende Audio-Uhr bleibt der vorhandene HTML-Audio-Pfad mit erhaltener Tonhöhe verfügbar. BTS bereitet die Audiowiedergabe pro Browser automatisch vor; verlangt dessen Autoplay-Regel eine Interaktion, wird die Freigabe beim nächsten normalen Klick, Tastendruck oder Touch im BTS automatisch wiederholt.

## Automatische Schnitte

Vosk arbeitet lokal mit dem gepinnten kleinen deutschen Modell. Pro Quelle werden Wortzeitmarken einmal ermittelt und gecacht. Aus dem exakten Quelltext und den erkannten benachbarten Wörtern werden individuelle Grenzen abgeleitet. Stille und nahe Nulldurchgänge verfeinern sie. Bei fließend verbundenen Wörtern kann ein energietragender Rand bleiben; dafür gibt es kurze Fades. Scheitert bei einem Team der Übergang zu „gegen“, kann eine zweite, auf den Quelltext begrenzte lokale Erkennung den Anker bestätigen. Sie darf ausschließlich diesen einen Verbinder korrigieren; die gewöhnliche Erkennung muss ihn an derselben Stelle ebenfalls stützen. Erfolgreiche bestehende Schnitte bleiben unverändert.

Ist weiterhin kein sicherer Namensschnitt möglich, steuert **BTS** einen begrenzten Fallback: einmal dieselbe vollständige Kontextaufnahme mit Seed 43 statt 42 erzeugen und den Namen daraus schneiden. Zwei problematische Teams derselben Quelle teilen diese neue Aufnahme. Scheitert auch dieser Schnitt oder die neue Quelle, wird als letzter Fallback der vollständige Teamname allein erzeugt und als Ganzes mit dem üblichen Tempo aufbereitet. Scheitert auch das, endet die automatische Wiederholung für diesen Baustein. Es gibt weiterhin nur einen offenen Sprachserver-Auftrag. Die Liste zeigt die neue Kontextaufnahme bzw. die Einzelaufnahme samt Ursache ausdrücklich an. Quellen und erfolgreiche Fallback-Zuordnungen werden dauerhaft gecacht und nach einem Neustart wiederverwendet; die ursprüngliche Spielaufnahme bleibt erhalten. Andere Ausschnittarten erhalten keinen zusätzlichen kurzen TTS-Fallback. Im Automatikmodus bleibt bei fehlenden Bausteinen der sichtbare Browser-Fallback verfügbar.

Die festen Frame-Grenzen und die einmalige Rauschkorrektur des Hörversuchs werden nicht auf unbekannte Turnieraufnahmen übertragen. Schnittprotokolle liegen im Sprachserver unter `data/alignment/*.cut.json` mit Quellhash, Wortmodell, Frames und Randpegeln. Automatische Worterkennung und technische Abspieltests ersetzen keine Klangabnahme ungewöhnlicher Namen.

## Aktivieren und prüfen

Im Sprachserver einmal `bash scripts/install-context.sh` ausführen; für die Modellinstallation kann `--archive /pfad/vosk-model-small-de-0.15.zip` verwendet werden. Danach Sprachserver und BTS neu starten und Clientseiten neu laden. `/health` muss `context_version: bts-context-v1` melden. Fehlt die optionale Erkennung, bietet der Server die neue Strategie nicht an; alte Server und Browser-TTS bleiben kompatibel. `BTS_CONTEXT_ENABLED=false` schaltet diese Strategie serverseitig ab.

Die vorhandene Turnierauswahl von Stimme und Sprachmodus gilt weiterhin für alle Clients. Nur diese ausgewählte lokale Stimme wird vorbereitet. Der neue Kontextbestand wird vorab aufgebaut; noch unvollständige Aufrufe werden weiterhin als solche angezeigt.

Bereits geprüfte Bereitschafts-Icons werden bei einem Neuaufbau der Spielzeile sofort aus den unveränderten Ansageteilen wiederhergestellt. Hintergrundprüfungen setzen einen bekannten Zustand nicht vorübergehend auf „unbekannt“. Unveränderte Icons erhalten keine neuen DOM-Attribute. Geänderte Texte, Stimme oder Synthesekonfiguration sowie tatsächliche Cachefehler aktualisieren weiterhin die betroffenen Anzeigen.

## Validierung

103 Sprachserver-Tests bestanden, die beiden bisherigen teuren Modelltests blieben opt-in. 179 BTS-Sprachtests und 17 zusätzliche Integrationstests mit FastAPI und echtem Chrome bestanden; ESLint meldet für die geänderten JavaScript-Dateien keine Fehler. Die Tests vergleichen sämtliche gesprochenen Wörter und Browsertexte über optionale Turniereinstellungen hinweg und prüfen Vorabplanung, Quellabhängigkeiten, Cache-Wiederverwendung und die gemeinsame Audio-Uhr. Die fünf Balkenzustände sind einschließlich Mehrfachverwendung, grauem Potenzial ohne Generierungsauftrag, unverändertem Balken-DOM und Neustarts vor und nach dem Abschluss einer neuen Generierung geprüft.

Ein zusätzlicher Regressionstest bereitet drei Spiele ohne Feldzuweisung und alle 13 Feldreferenzen vor. Anschließend ruft er acht B01-basierte Ansagearten für jedes Spiel auf jedem Feld ab. Alle Stücke sind bereits fertig; weder eine weitere Quelle noch ein Ausschnitt oder ein zusätzlicher Sprachserver-Auftrag wird angelegt.

Die dauerhafte Speicherung wird zusätzlich mit HTTP-Downloads und echten Hardlinks geprüft: Neustart mit abgeschaltetem Sprachserver, signierte lokale Wiedergabe einschließlich Range/ETag, Wiederherstellung von Kontextstücken und Pausen, Wechsel der Syntheseidentität, beschädigte Dateien, Index-Schreibfehler ohne erneute Synthese sowie die Umstellung vorhandener Kopien auf Hardlinks ohne API-Aufruf. Ein FastAPI-/Chrome-Test beendet den tatsächlichen API-Prozess und prüft anschließend grüne Bereitschaft und Wiedergabe über einen frisch gestarteten BTS-Adapter. Ein Sprachserver-Test prüft die Erhaltung geteilter Dateien bei der Bereinigung und die Ablehnung eines vollen geschützten Caches vor einem neuen Modelllauf.

Der separate Durchlauf `bts-sprachserver/data/integration/context/cdaa5732dbfe/` bereitete alle 32 Varianten des Beispielspiels über den echten BTS-Adapter vor: 14 Kontextquellen und 30 Ausschnitte sowie ein separater Sprachtest, keine fehlgeschlagenen Aufträge. Passende vorhandene Kitten-Rohaufnahmen wurden nur gelesen, fehlende Quellen mit dem nativen Worker erzeugt. Ein echter Chrome spielte D01 ohne Offizielle, D05, D08/Klapptafel und D12 mit beiden Siegern über die neue Audio-Uhr vollständig ab, ohne Browser-Fallback oder JavaScript-Fehler.
