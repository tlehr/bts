# BTS-Kontextstrategie v2 – gemeinsame Festlegungen

Diese Datei hält die schrittweise festgelegte neue BTS-Strategie fest. Sie beschreibt den vorgesehenen automatischen Aufbau im BTS; dafür ist keine Bedienung des Kontexteditors vorgesehen. Die bereits gesicherte und laufende v1 bleibt bis zur Umsetzung der neuen Strategie der dokumentierte bisherige Stand. Das [v1-Arbeitsdokument](durchsagen-arbeitsdokument.md) und die [gemessenen v2-Versuche](context-v2-experiments.md) bleiben getrennt nachvollziehbar.

## 1. Festgelegt: eine Kontextaufnahme je tatsächlichem Team

Für jedes Team wird dieser vollständige Kontext erzeugt:

```text
[Team] spielt jetzt gegen [Team]!
```

Beide Vorkommen enthalten **dasselbe Team**. „Spielt jetzt“ ist Kontext für die Betonung und wird nicht abgespielt. Die Quelle endet mit dem gewünschten Ausrufezeichen und enthält weder einen anderen Gegner noch eine Spielnummer, ein Feld, eine Disziplin oder eine Runde.

- **Einzel:** `[Team]` ist der vollständige Spielername.
- **Doppel und Mixed:** `[Team]` enthält beide vollständigen Spielernamen mit „und“, in der tatsächlichen Teamreihenfolge. Die Namen werden nicht in Vor-/Nachnamen oder Einzelwörter zerlegt.
- Nur tatsächlich vorkommende Teams werden berücksichtigt. Es werden keine hypothetischen Paarungen gebildet. Ein noch unvollständiges Team wird nicht durch erfundene Namen ergänzt.
- Dasselbe Team in mehreren Spielen verwendet dieselbe passende Kontextaufnahme. Gegnerwechsel, Spielnummer und Feldzuweisung erzeugen keine zusätzliche Teamaufnahme.
- Spielt eine Person mit unterschiedlichen Partnern, sind das unterschiedliche Teams und entsprechend unterschiedliche Kontexttexte.
- Die einmalige Generierung gilt jeweils für die gewählte Stimme, Modell-/Synthesekonfiguration und Ausspracheversion. Ein passender vorhandener Quellcache wird wiederverwendet.

Beispiele für die Quellen:

```text
Johann Bjarne Schöttmer spielt jetzt gegen Johann Bjarne Schöttmer!

Milo Ebeling und Adrian Kranig spielt jetzt gegen Milo Ebeling und Adrian Kranig!
```

Die vorhandenen BTS-Ausspracheersetzungen und die Zahlenausschreibung werden vor der Übergabe an den Sprachserver angewendet. Die Anzeige der Namen bleibt davon getrennt. Die Formel einschließlich „spielt“ gilt unverändert auch für Doppel, wie vom Nutzer vorgegeben. Die bisherigen Quellen `Team gegen Team` ohne Satzzeichen sowie die älteren Laborbeispiele mit abschließendem Punkt bleiben als eigene Referenzen erhalten und werden nicht stillschweigend zu dieser Quelle umbenannt.

## 2. Team-Ausschnitte und Verwendung im Hörtest

Die Quelle stellt beide Teampositionen mit dem gesprochenen Verbinder „gegen“ bereit. Die möglichen Bereiche sind:

```text
Team an erster Position | spielt jetzt (verwerfen) | gegen | Team an zweiter Position
```

Für die angeforderten Spielblock-Hörproben werden zwei Montagen **derselben** Quellen verglichen: `Team 1 → gegen mit Team 2` sowie `Team 1 → gegen → Team 2`. „Gegen“ bleibt in der ersten Montage am zweiten Team, weil diese beiden Teile in der neuen Kontextaufnahme direkt aufeinander folgen. Team 1 und „gegen“ sind durch den verworfenen Kontext getrennt und werden deshalb nicht als zusammenhängender Ausschnitt ausgegeben. Dafür werden keine zusätzlichen Namen oder Begegnungen isoliert generiert. Beide Positionen behalten ihre eigene Herkunft und Betonung, obwohl ihr Text identisch ist. Die Auswahl der endgültigen Montage und der Pausen bleibt vom Hörvergleich abhängig.

Schnittgrenzen beziehen sich immer auf die tatsächlich erzeugte Original-WAV und ihren Hash. Ein sicherer Schnitt wird nicht aus der Zeichenlänge oder aus festen Zeiten einer anderen Aufnahme abgeleitet. Vollständige Namen und leise An-/Auslaute müssen erhalten bleiben.

## 3. Festgelegt: die übrigen Teile des Spielblocks

| Teil | Vollständige Generierung | Verwendung |
| --- | --- | --- |
| B03 Spielnummer | `Spielnummer [Nummer] ist als nächstes an der Reihe.` | Nur `Spielnummer [Nummer]` ausschneiden; der Nachsatz wird nicht abgespielt |
| B04 Disziplin und Altersklasse | `Im [Disziplin] [Altersklasse] erwarten wir spannende Spiele!` | Nur `[Disziplin] [Altersklasse]` ausschneiden; „Im“ und der Nachsatz werden nicht abgespielt |
| B05 Runde | `[Runde]!` | Direkt und vollständig abspielen; dieser Klang ist im Spielblock vom Nutzer bestätigt |
| B07 Begegnung | Je tatsächlichem Team: `[Team] spielt jetzt gegen [Team]!` | Erste Position von Team 1, Verbinder „gegen“, zweite Position von Team 2; alternativ Verbinder und Team 2 als gemeinsames Stück. „Spielt jetzt“ verwerfen |

Damit ergibt sich:

```text
Spielnummer [Nummer].
→ [Disziplin] [Altersklasse]!
→ [Runde]!
→ [Team 1] gegen [Team 2]
```

Spielnummern werden je Nummer, Disziplinen je Kombination mit Altersklasse und Runden je gesprochenem Rundentext dedupliziert. Für denselben Spielblock auf einem anderen Feld ist keine neue Generierung nötig. Zahlen werden vor der Synthese ausgeschrieben; die Anzeige behält Ziffern. Aktuelle Ausspracheersetzungen werden angewendet. Die Quelle für B04 enthält echte Umlaute und die im Hörvergleich gewählte Trennung mit Leerzeichen, etwa „Mädchen Einzel“.

Für die lokale v2-Disziplinquelle werden `Jungeneinzel`, `Jungendoppel`, `Mädcheneinzel`, `Mädchendoppel`, `Herreneinzel`, `Herrendoppel`, `Dameneinzel` und `Damendoppel` zu `Jungen Einzel`, `Jungen Doppel`, `Mädchen Einzel`, `Mädchen Doppel`, `Herren Einzel`, `Herren Doppel`, `Damen Einzel` und `Damen Doppel`. Bereits getrennte Bezeichnungen wie `Gemischtes Doppel` sowie `Einzel` und `Doppel` bleiben unverändert. Die Anzeige behält die übliche Zusammenschreibung. Die Regel wird ausschließlich auf die Disziplin angewendet, nicht auf Spielernamen oder den Browsertext.

Beispielquelle: `Im Jungen Doppel U dreizehn erwarten wir spannende Spiele!`. Disziplin und Altersklasse bleiben ein gemeinsamer Ausschnitt aus dieser Aufnahme; innerhalb der Disziplin werden keine Einzelwörter zusammengeschnitten. Der geänderte Quelltext erhält automatisch einen eigenen Cache-Schlüssel. Nummern-, Runden- und Teamquellen behalten ihre bisherigen Schlüssel; eine allgemeine Cache-Löschung oder neue Synthese dieser Bausteine ist nicht nötig.

Für B03 steht nach der Nummer innerhalb des Kontextsatzes **kein zusätzlicher Punkt**. Der Ausschnitt endet vor „ist“, damit er die im Satz erzeugte Betonung behält. Die angezeigte Spielblockfassung darf weiterhin einen Punkt nach der Spielnummer zeigen; die Pause zwischen B03 und B04 wird bei der Montage gesetzt.

Für B04 steht nach der Altersklasse ebenfalls **kein zusätzliches Satzzeichen** im Kontextsatz. Der Ausschnitt beginnt nach „Im“ und endet vor „erwarten“. Das abschließende Ausrufezeichen gehört nur zur vollständigen Kontextaufnahme; die Pause zur Runde entsteht bei der Montage. Die angezeigte Spielblockfassung behält ihr bisheriges Ausrufezeichen nach der Altersklasse.

Der Nutzer bestätigt den vollständigen bisherigen Spielblock mit dem neuen Teamkontext. Insbesondere passt die direkt erzeugte Runde im zusammengesetzten Spielblock; für B05 wird deshalb kein neuer Kontextsatz eingeführt. Texte, Bausteinfolge und Pausenziele bleiben für den anschließenden Hörvergleich mit der Hallensprecherin unverändert. Eine bevorzugte der beiden Begegnungsmontagen ist damit noch nicht ausdrücklich festgelegt.

### Angeforderte Hörproben

`scripts/tts-gameblock-context-plan.js` erzeugt den isolierten Hörplan aus dem privaten Turnierexport. Er enthält das bekannte Beispielspiel 189 (nicht das tatsächlich im Export gespeicherte Spiel 189) sowie die tatsächlichen Spiele 161 und 381 als weiteres Einzel und Doppel. Alle drei sind Achtelfinals.

- Drei Spielnummern, drei Kombinationen aus Disziplin und Altersklasse, **eine** gemeinsame Runde und sechs Teamkontexte ergeben **13 vollständige Quellaufnahmen**.
- Zwei Montagen je Spiel ergeben **sechs Hörproben**, ohne zusätzliche Synthese für die Vergleichsmontage.
- Die Testpausen betragen 250 ms zwischen Spielnummer, Disziplin, Runde und Begegnung sowie 60 ms an den Übergängen innerhalb der Begegnung. Vorhandene Randstille wird angerechnet. Diese Werte sind zunächst Hörtest-Einstellungen.
- Gesprochen wird mit Hallensprecher, Seed 42 und dem bisherigen Wiedergabetempo 1,155. Kein Kontexttext wird stellvertretend als kürzerer Generierungsaufwand gezählt.

Die fertige private Hörseite liegt im vorhandenen Hörpaket unter `spielbloecke/`. Sie bietet beide Montagen, eine Abspielfolge der drei Spiele sowie pro Baustein Quelltext, Originalaufnahme, Schnittdaten und den einzelnen Ausschnitt. Ein unsicherer Schnitt bleibt als solcher gekennzeichnet. Audiodateien und der private Turnierexport werden nicht in Git aufgenommen.

Für den ausdrücklich gewünschten Vergleich mit der Hallensprecherin wird derselbe Plan ohne Änderungen an Texten, Bausteinfolge oder Pausenzielen verwendet. Die weibliche Stimme hat eigene Quellaufnahmen und Schnitte und verwendet ihr bisheriges Wiedergabetempo 1,05; die männliche bleibt bei 1,155. Es gibt weiterhin eine Aufnahme pro eigenständiger Nummer, Disziplin-/Altersklassenkombination, Rundentext oder tatsächlichem Team und gewählter Stimme. Die sechs weiblichen Montagen liegen separat unter `spielbloecke-hallensprecherin/`; beide Hörseiten verlinken einander. Die männlichen Audiodateien und die produktive Stimmenauswahl bleiben erhalten. Eine Bestätigung der weiblichen Hörqualität liegt erst nach dem Vergleich durch den Nutzer vor.

Der weibliche Vergleich vom 17. Oktober erzeugte 13 Quellen mit 764 Eingabezeichen und 58,12 Sekunden Roh-Audio; die tatsächliche Inferenz dauerte 230,89 Sekunden, der gesamte Laborlauf 252,59 Sekunden. Alle sechs Montagen sind verfügbar. Die 63 männlichen Audioartefakte bleiben bytegleich. Der reine weibliche Cache-Lauf trifft alle 13 Quellen und 19 Wiedergabestücke, lädt keine Modelle und erzeugt weder neue Sprache noch neue Schnitte; die Montagen bleiben bytegleich. Beide Hörseiten wurden auf Wiedergabe, Abspielfolge, Stopp sowie Quellen- und Stimmenlinks geprüft.

Der tatsächliche Versuch vom 17. Oktober 2026 hat alle 13 Quellen erzeugt. Nach einer Korrektur der Positionszuordnung bei identischen Teamwiederholungen sind alle sechs Montagen verfügbar; dafür wurde keine Quelle erneut synthetisiert. Beim Doppel bleibt die aktiv gesprochene Grenze nach „gegen“ in beiden Montagen als Hörprüfstelle markiert. Ein weiterer reiner Cache-Lauf verwendet sämtliche Quellen und 19 Wiedergabestücke ohne neue Synthese und ohne Modellladen wieder.

Anschließend wurde B03 auf den oben beschriebenen Kontextsatz umgestellt. Dafür brauchen die drei Beispielnummern jeweils eine neue Kontextaufnahme; die zehn anderen Quellen passen weiterhin zum vorhandenen Cache. Die Hörseite `spielbloecke/` verwendet den neuen Aufbau. Der bisherige Vergleich mit direkt erzeugter Spielnummer bleibt unter `spielbloecke-direkte-spielnummer/` erhalten.

Die folgende Anpassung von B04 verwendet den oben beschriebenen Satz „Im … erwarten wir spannende Spiele!“. Dafür werden nur die drei Disziplin-/Altersklassenquellen neu erzeugt; Nummern, Runde und Teams bleiben wiederverwendbar. Die bisherige Fassung mit „Wir rufen auf:“ bleibt unter `spielbloecke-wir-rufen-auf/` erhalten, die aktuelle Fassung liegt weiterhin unter `spielbloecke/`.

Der Hörtest hat beim Jungendoppel einen Rest von „Im“ im Ausschnitt bestätigt. Die zunächst verwendete einzelne Wortmarke bei etwa 108 ms wird deshalb verworfen. Eine auf den bekannten Kontext begrenzte zusätzliche Erkennung verankert sowohl das Ende von „Im“ als auch den Anfang von „Jungen“ bei etwa 210 ms. Der neue Schnitt verwendet diese beiden übereinstimmenden Marken derselben Originalaufnahme. Sämtliche 13 Quellen und die 18 anderen Bausteine bleiben bytegleich; neue Synthese ist dafür gesperrt. Auf der Hörseite stehen alter und korrigierter Ausschnitt im direkten Vergleich. Die Hörnotizen unterscheiden nun auch verschiedene Schnitte desselben Textplans.

Der Nutzer bestätigt anschließend den korrigierten Schnitt, hört aber im Wort „Jungendoppel“ eine unpassende Aussprache („Jungend doppel“). Für einen gezielten Vergleich werden im selben Kontext die Schreibweisen `Jungendoppel`, `Jungen-Doppel` und `Jungen Doppel` verwendet. Nur die beiden neuen Schreibweisen benötigen eine neue Synthese; die bestätigte bisherige Aufnahme wird wiederverwendet. Die Anzeige bleibt `Jungendoppel U13`. Jede Probe enthält die vollständige Disziplin und Altersklasse aus einer einzigen Quelle, ohne Schnitt innerhalb des Wortes. Neue WAVs erhalten eigene Schnittgrenzen.

`disciplinePronunciationTrials` im Planskript erzeugt diesen Vergleich unabhängig vom jeweils aktuellen Spielblockplan und kann sowohl die frühere Zusammenschreibung als auch die neue getrennte Quelle wiederverwenden. Die separate Hörseite liegt unter `aussprache-jungendoppel/`.

Im anschließenden Hörvergleich wählt der Nutzer **die Variante mit Leerzeichen** und bittet um Übernahme für alle Disziplinen. Damit gilt die oben dokumentierte Regel für sämtliche v2-Spielblockpläne. Die Hörseite `spielbloecke/` wird entsprechend aktualisiert; die bisherige Fassung bleibt unter `spielbloecke-disziplinen-zusammen/` erhalten. Die produktive v1 wird dadurch nicht umgestellt.

Die sechs aktualisierten Hörproben vom 17. Oktober benötigen zwei neue Synthesen: `Mädchen Einzel U19` und `Jungen Einzel U17`. Die gewählte `Jungen Doppel U13`-Aufnahme wird bytegleich übernommen. Insgesamt werden elf Quellaufnahmen und 17 Wiedergabestücke aus dem Cache wiederverwendet. Die zwei neuen Quellen umfassen 117 gesprochene Eingabezeichen und 8,64 Sekunden Roh-Audio; gemessen wurden 46,19 Sekunden reine Inferenz und 59,86 Sekunden für den gesamten Laborlauf. Alle sechs Montagen sind verfügbar. Neue Schnittgrenzen bleiben im Bericht als Hörprüfstellen gekennzeichnet; die Auswahl der bisherigen Doppelprobe ist mit deren exaktem Audiohash dokumentiert. Automatisierte Tests prüfen alle zwölf unterstützten Disziplinkürzel, unveränderte Anzeigen und Namen sowie Cache-Wiederverwendung beider früheren Schreibweisen.

Anschließend wird die Teamquelle auf `[Team] spielt jetzt gegen [Team]!` geändert. Die sechs neuen Teamquellen der drei Hörbeispiele umfassen zusammen 376 Eingabezeichen und 29,28 Sekunden Roh-Audio; die tatsächliche Inferenz dauert zusammen 142,19 Sekunden. Ein zunächst unsicheres „spielt“ beim Doppel wird durch eine zusätzliche, zeitlich übereinstimmende Kontexterkennung abgesichert und aus derselben Quelle neu geschnitten. Dafür wird keine Teamaufnahme wiederholt. Die sieben Spielnummern-, Disziplin- und Rundenbausteine bleiben bytegleich im Cache. Alle sechs Montagen liegen unter `spielbloecke/`; die bisherige Teamfassung bleibt unter `spielbloecke-team-ohne-spielt-jetzt/` erhalten. Die erste Montage verbindet nun `Team 1` mit dem zusammenhängenden Ausschnitt `gegen Team 2`; „spielt jetzt“ ist in keinem Wiedergabebaustein enthalten.

Der abschließende reine Cache-Lauf trifft alle 13 Quellen und 19 Wiedergabebausteine, benötigt keine Synthese und lädt weder Sprach- noch Ausrichtungsmodell. Die sechs Montagen und ihre Hörkopien sind bytegleich zum vorherigen fertigen Lauf; gemessen wurden 9,45 Sekunden einschließlich Identitätsprüfung und Export. Wiedergabe, Abspielfolge, Stopp und Quellenlinks wurden im lokalen Chrome geprüft.

## 4. Bezug zum bisherigen Aufbau

Aktuell gewinnt `static/js/speech_context.js` die Team-Ausschnitte aus dem vollständigen tatsächlichen Spielblock (`gamePieces` / `teamPiece`). Die neue Festlegung ersetzt für die künftige v2-Teamquelle diese Bindung an den jeweiligen Spielgegner durch den wiederholten eigenen Teamkontext. Sie schaltet noch nicht eigenständig die gesamte Strategie um; der übrige Aufbau und die genaue Schnittverwendung werden weiter festgelegt.

Der Sprachserver unterstützt bereits vollständige Kontextquellen und quellengebundene Ausschnitte. Die spätere BTS-Planung muss passende Quellen deduplizieren, ihre Positionsausschnitte referenzieren und weiterhin nur einen Sprachserverauftrag zur Zeit senden. Die bestehende Priorisierung wird durch diese Festlegung nicht neu geordnet. Die Anwesenheitskontrolle bleibt außerhalb des Umfangs.
