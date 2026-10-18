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

Der Sprachserver unterstützt bereits vollständige Kontextquellen und quellengebundene Ausschnitte. Die spätere BTS-Planung muss passende Quellen deduplizieren, ihre Positionsausschnitte referenzieren und weiterhin nur einen Sprachserverauftrag zur Zeit senden. Die bestehende Priorisierung wird durch diese Festlegung nicht neu geordnet. Die zunächst ausgeklammerte Anmeldung/Anwesenheitskontrolle wird auf Wunsch jetzt zusätzlich geplant; Bestandsaufnahme und Prüfentwurf stehen in [Abschnitt 22 des Arbeitsdokuments](durchsagen-arbeitsdokument.md#22-anmeldung--anwesenheitskontrolle-bestandsaufnahme-und-v2-entwurf). Ihre produktive Umsetzung und Sprachgenerierung sind noch nicht erfolgt.

## 5. Weitere Hörvergleiche mit beiden Stimmen

Ab jetzt werden die weiteren abgestimmten Hörbeispiele jeweils mit **Hallensprecher und Hallensprecherin** bereitgestellt. Geeignete vorhandene Quellen und Ausschnitte der jeweiligen Stimme werden zuerst wiederverwendet. Die Stimmen behalten ihre eigenen Cache-Schlüssel, Schnittgrenzen und Hörbewertungen. Diese Vereinbarung betrifft das Hörlabor; für die produktive Vorbereitung gilt weiterhin die zentral ausgewählte Stimme.

Der Spielblock B03 → B04 → B05 → B07 bleibt in seinem bestätigten Aufbau erhalten. Außerhalb dieses Blocks bestehen bereits v1-Kontextvorlagen; sie sind Ausgangspunkt für die folgenden v2-Hörtests. Die Tabelle benennt noch abzustimmende beziehungsweise zu prüfende Bereiche und keine Liste bereits beauftragter neuer Generierungen.

| Reihenfolge | Bereich | Grundlage für den nächsten Kontextvergleich |
| --- | --- | --- |
| 1 | B01 Feldanfang und Feldende | Vollständiger Referenz-Spielaufruf mit derselben Feldansage am Anfang und Schluss; beide Positionen getrennt ausschneiden. Zuerst Feld acht und Übergänge zum bestätigten Spielblock prüfen. Die feste v1-Referenz aus Abschnitt 7.1 des Arbeitsdokuments bleibt als Vergleich erhalten. |
| 2 | B12 Spielbeginn | `Auf Spielfeld acht! Bitte mit dem Spielen beginnen!`; daraus die vollständige Startanweisung gewinnen und mit B01-Anfang prüfen. |
| 3 | B02, B09, B10 Vorbereitung, Halle und Treffpunkt | Vollständiger Vorbereitungsaufruf; Anfang und Abschluss sowie Einzahl-/Mehrzahlformen der Hallen- und Treffpunkttexte abstimmen. |
| 4 | B08 Schiedsrichter, Aufschlagrichter, Tablet-/Klapptafelbedienung | Bevorzugt gemeinsame Rollenbezeichnung aus einem vollständigen Kontext ausschneiden und mit vorhandenen Namens-/Teamaufnahmen verbinden. Zuerst Tabletbedienung mit beiden Stimmen prüfen; zusätzliche Rollen-/Namensaufnahmen nur bei belegtem klanglichem Bedarf. |
| 5 | B11 Zweitaufruf-Präfixe | `Zweiter Aufruf für:` und `Zweiter Aufruf In Vorbereitung für:` im Zusammenhang mit Team beziehungsweise Rolle und Namen gewinnen. Passende Quellen aus den vorherigen Bereichen zuerst verwenden. |
| 6 | D12 Kampflos-Klausel | `Das Spiel geht kampflos an` mit Siegerteam in einem vollständigen Kontext erzeugen und mit dem bestätigten Spielblock und vorhandenen Teamaufnahmen prüfen. |

Freie Ansagen und der Sprachtest bleiben vollständige Äußerungen. Die Evakuierung bleibt die bestehende Aufnahme. Dafür ist in diesem Schritt kein neuer Kontextsatz vorgesehen.

### 5.0 Bevorzugter B08-Aufbau: gemeinsame Rolle + vorhandenes Team

Der Betreiber bevorzugt ausdrücklich Variante 2, um zusätzliche Generierungen
je Rollen-/Namenskombination zu vermeiden. Für B08 wird zunächst nur die
Rollenbezeichnung im Kontext aufgenommen. Der vollständige Name beziehungsweise
das Doppelteam kommt aus den vorhandenen Teamaufnahmen, ohne „gegen“ und ohne
Aufteilung in Einzelwörter. Diese neue v2-Festlegung ersetzt den bisherigen
Prüfvorschlag „Rolle mit Namen zusammenhalten“; die gesicherte v1 bleibt erhalten.

Der erste Hörversuch beginnt mit `Tabletbedienung:` und beiden Stimmen:

```text
Auf Spielfeld acht! Zweiter Aufruf für:Tabletbedienung:[vorhandenes Beispielteam]
```

Aus einer solchen Quelle je Stimme werden die gemeinsame Rolle und zusätzlich
das Präfix `Zweiter Aufruf für:` ausgeschnitten. Die im Kontext gesprochenen
Beispielnamen werden beim späteren Zusammenbau durch vorhandene Namens- und
Teamstücke ersetzt. Dieselbe Rollenaufnahme wird unabhängig von Spiel, Feld,
Einzelperson oder Doppelteam wiederverwendet. Es gibt keine neue Synthese je
Tabletzuordnung oder Name.

Der Hörvergleich prüft Rolle + Einzelperson, Rolle + Doppelteam, einen
vollständigen D01-Spielaufruf und D08-Zweitaufrufe mit den vorhandenen Feld- und
Spielstücken. Das erste Pausenziel zwischen Rolle und Name beträgt 80 ms;
Randstille wird angerechnet. Die zentralen Pausen- und Lautheitsregeln gelten.
Die Variante wird erst nach der Klangprüfung bestätigt; daraus folgt keine
automatische neue Tabletzuordnung oder produktive v2-Umschaltung.

Reproduzierbarer Generierungsplan: `scripts/tts-tablet-role-plan.js` mit einem
vorhandenen v2-Feld-/Teamplan als Eingabe. Für den ersten Test sind genau eine
neue Rollen-Kontextquelle je Stimme und keine zusätzlichen Namensquellen vorgesehen.

Der erste tatsächlich veröffentlichte Hörsatz liegt unter
`http://127.0.0.1:8084/tabletbedienung/`: zwölf Proben mit beiden Stimmen,
gemeinsamer Rolle, vorhandenem Einzel-/Doppelteam und vollständigen D01-Aufrufen.
Für beide Bedienformen wird je Stimme exakt dieselbe Rollenaufnahme verwendet.
Die Beispiele verändern keine Tabletzuordnungen des Turniers.

Die Männerquelle aus dem normalen Zweitaufruf besteht beim ersten Versuch und
liefert zusätzlich den später nutzbaren B11-Ausschnitt. Bei der Hallensprecherin
werden drei Kandidaten dieses langen Kontextes wegen überlanger Pausen verworfen.
Der kürzere Kontext `Die Tabletbedienung übernimmt Max Hahn.` besteht beim ersten
Versuch; nur `Tabletbedienung` wird ausgeschnitten. „Die“ und „übernimmt Max Hahn.“
gehören ausschließlich zur Quelle. Der Doppelpunkt wird nicht gesprochen.

Damit entstehen zwei verwendete Rollenquellen aus insgesamt fünf
Aufnahmekandidaten; zusätzliche Team-/Namensquellen entstehen nicht.
Vorhandene Aufnahmen für Max Hahn und Emil Hermann und Konrad Wendt werden
wiederverwendet. Die v2-Quellen und das Tempo des Hallensprechers bleiben erhalten;
die Hallensprecherin verwendet die bestätigte Vorbereitungsreferenz.
Die gemeinsamen Pausen-/LUFS-Regeln werden auf die dauerhaft gespeicherten
Wiedergabestücke angewendet. Die Rollen-/Namensübergänge der Tabletbedienung sind
vom Betreiber klanglich bestätigt („Top! Weiter!“). Die bestätigten Stücke
bleiben für die folgenden Rollenvergleiche unverändert erhalten.
Die vollständigen D08-Hörproben folgen mit den gemeinsamen B11-Präfixen.

### 5.0.1 Weitere B08-Rollen nach demselben Muster

Nach Bestätigung der Tabletbedienung folgen Schiedsrichter, Aufschlagrichter
und Klapptafelbedienung. Je Rolle und Stimme entsteht eine gemeinsame Quelle:

| Rolle | Kontextsatz | Verwendeter Ausschnitt |
| --- | --- | --- |
| Schiedsrichter | `Der Schiedsrichter ist Max Hahn.` | `Schiedsrichter` |
| Aufschlagrichter | `Der Aufschlagrichter ist Max Hahn.` | `Aufschlagrichter` |
| Klapptafelbedienung | `Die Klapptafelbedienung übernimmt Max Hahn.` | `Klapptafelbedienung` |

Die Personenbezeichnung im Kontext ist ein vorhandener vollständiger
Einzelname aus dem Testplan. Nur die Rolle wird übernommen; Artikel und
Nachsatz werden verworfen. Vorhandene Namens-, Team-, Spiel- und Feldstücke
aus dem bestätigten Tablet-Hörsatz bleiben bytegleich. Für eine andere
Rollen-/Namenskombination wird keine weitere Quelle erzeugt. Klapptafel und
Tablet werden als alternative Bedienformen geprüft, nicht gemeinsam zugeordnet.

`scripts/tts-official-role-plan.js` erzeugt den Plan. Der Hörsatz vergleicht
die beiden Richterrollen mit einer Einzelperson und die Klapptafelbedienung
mit einer Einzelperson sowie einem Doppelteam. Jeweils gibt es Rolle + Name,
einen vollständigen D01-Spielaufruf, die Rolle allein und den vollständigen
Kontext. Die vorgesehenen 28 Proben für beide Stimmen sind nach Rolle filterbar.
Die 80-ms-Übergangspause und die zentralen Wiedergaberegeln bleiben erhalten.

### 5.0.2 Fehlende Namen technischer Offizieller

Bestätigter v2-Plan: Für einen angeforderten Schiedsrichter oder Aufschlagrichter
wird zuerst ein vorhandener vollständiger Einzelname aus der zweiten Position
gesucht. Fehlt er, entsteht einmal je vollständigem Namen und Stimme die Quelle:

```text
[Name] spielt jetzt gegen [Name]!
```

Verwendet wird das zweite Namensvorkommen ohne „gegen“. Genau derselbe Baustein
kann bei mehreren Spielen, beiden Richterrollen und später bei Spielernamen
wiederverwendet werden. Rolle, Feld und Spiel gehören nicht zum Namensschlüssel.
Stimme, Syntheseidentität, Aussprache und prosodische Position bleiben getrennt.
Die gemeinsame Rollenaufnahme wird vor den Namen gesetzt; hierfür gilt weiterhin
das 80-ms-Pausenziel einschließlich Randstille.

Der Planer `scripts/tts-official-name-plan.js` erhält einen vorhandenen v2-Plan
und explizite Aufträge mit `setup.umpire.name` / `setup.service_judge.name`.
Er normalisiert Namen wie der Spielerplan, fasst gleiche gesprochene Namen
rollenübergreifend zusammen und übernimmt vorhandene passende Stücke unverändert.
Er bereitet keine gesamte Offiziellenliste vor. Leere Zuordnungen und „kein Spiel“
enthalten keine Namensaufträge. Aus Doppelteams werden keine Einzelpersonen
herausgeschnitten; ein nur im Doppel vorhandener Offizieller erhält bei Bedarf
seine eigene Einzelnamensquelle.

Hörvergleich: `http://127.0.0.1:8084/offizielle-namen/` mit beiden Stimmen.
„Tim Lehr“ wird einmal je Stimme erzeugt und für Schiedsrichter sowie
Aufschlagrichter geteilt. „Max Hahn“ kommt aus dem vorhandenen Spieler-Namenscache.
Diese expliziten Hörbeispiele verändern keine Turnierzuordnungen. Der Betreiber
hat den vollständigen Hörvergleich mit beiden Stimmen bestätigt („passt alles!“),
einschließlich des markierten Tim-Lehr-Schnitts der Hallensprecherin. Der
automatische Schnittbefund bleibt als Herkunftsinformation erhalten; die
Hörbestätigung gilt diesen konkreten Aufnahmen, nicht künftigen Namensschnitten.
Es gibt noch keine produktive v2-Umschaltung.

Als nächster Hörbereich folgt B11: normales Zweitaufruf-Präfix und
Vorbereitungs-Präfix, kombiniert mit den bestätigten Team- und Rollenstücken.
Der vorhandene männliche B11-Ausschnitt wird zuerst verwendet. Geprüft werden
Team-Zweitaufrufe D04/D05 sowie die Offiziellen-Zweitaufrufe D06–D11 mit den
jeweiligen Location-/Treffpunktvarianten. Anschließend folgt die D12-Kampflos-Klausel.

### 5.0.3 B11: Zweitaufrufe mit beiden Stimmen

Hörseite: `http://127.0.0.1:8084/zweitaufrufe/`. Pro Stimme gibt es 20 vollständige
Durchsagen für D04–D11, drei Einzelbausteine und zwei Kontextreferenzen. Insgesamt
sind es 50 Proben. Einzelnamen, Doppelteams, alle vier Rollen sowie Offiziellen-
Zweitaufrufe ohne Feldzuweisung werden geprüft. Der Betreiber hat den aktuellen
Hörsatz für beide Stimmen klanglich bestätigt („Passt!“). Die Bestätigung gilt
den konkreten Aufnahmen und dem dokumentierten Location-Stand.

`scripts/tts-second-call-plan.js` verwendet für Wortlaut und Satzfolge die
Browser-Textfunktionen. Ein Tokenvergleich nach Zahlenausschreibung verhindert
fehlende, zusätzliche oder vertauschte Wörter. Die tatsächlichen Location-
Einstellungen werden übernommen. Im gespeicherten Stand „Campus Helleweg“ sind
Hallenzusatz und Treffpunkt leer und die Treffpunktfunktion ausgeschaltet.
Weitere Locations und ihre Einzahl-/Mehrzahlformen werden vom Planer unterstützt,
aber in diesem Hörsatz nicht erfunden oder zusätzlich generiert.

| Stimme | Kontextquelle | Verwendete neue Stücke |
| --- | --- | --- |
| Hallensprecher | `Zweiter Aufruf In Vorbereitung für:Tabletbedienung:Max Hahn! Max Hahn, bitte als Tabletbedienung.` | `Zweiter Aufruf In Vorbereitung für:` und `bitte als Tabletbedienung` |
| Hallensprecherin | Derselbe Vorbereitungskontext | Dieselben zwei Stücke |
| Hallensprecherin | `Zweiter Aufruf für:Max Hahn. Auf Spielfeld acht!` | `Zweiter Aufruf für:` |

Das normale Männerpräfix bleibt der vorhandene Ausschnitt aus der Tabletquelle.
Die übrigen Team-, Namens-, Rollen-, Feld- und Vorbereitungsstücke bleiben
bytegleich. Auch die abschließende Aufforderung für D11 wird zwischen Einzelperson,
Doppelteam, Tablet und Klapptafel geteilt. Der derzeitige Browserwortlaut
`bitte als Tabletbedienung` bleibt dabei auch im Klapptafel-Fall erhalten.

Es gibt drei verwendete neue Quellen aus vier tatsächlichen Kandidaten. Der
erste weibliche Vorbereitungskandidat wird wegen überlanger Pausen verworfen;
Seed 43 besteht. Die übrigen Quellen bestehen mit Seed 42. Die neuen Schnitte
benötigen keine aktive Grenzwarnung; historische Namenswarnungen bleiben erhalten.
Die warmen Wiederholungsläufe benötigen keine Synthese und spielen bytegleiche
Bausteine. Die gemeinsame 100-ms-/LUFS-Aufbereitung, Stimmenreferenzen und Tempo
bleiben erhalten. Der Produktivbetrieb bleibt v1; D12 ist der nächste Hörbereich.

### 5.0.4 D12: gemeinsame Kampflos-Formulierung und Siegerteam nach „gegen“

Hörseite: `http://127.0.0.1:8084/kampflos/`. Der Betreiber wünscht für das Siegerteam
die Position nach „gegen“. Im aktuellen Hörsatz gewinnt jeweils die zweite Seite:
Max Hahn bei Spiel 161 sowie Emil Hermann und Konrad Wendt bei Spiel 381. Für den
Sieger wird das zweite vollständige Teamvorkommen aus der wiederholten Teamquelle
verwendet, ohne „gegen“, ohne Zerteilen der Namen und ohne neue Namensgenerierung.

Je Stimme erzeugt eine neue Kontextquelle:

```text
Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Muhammad Sytsh Abdulquddus gegen Max Hahn. Das Spiel geht kampflos an Max Hahn!
```

Daraus wird nur `Das Spiel geht kampflos an` übernommen. Der in der Quelle
mitgesprochene Sieger bleibt Kontext; die Montagen verwenden die vorhandene
Teamaufnahme nach „gegen“. Derselbe Kampflos-Baustein wird mit dem bestehenden
Spielblock und Siegerteam des Einzels sowie des Doppels verbunden. D12 enthält
keine Feldansage und keine Offiziellen. Die Spielangaben bleiben in der bestätigten
v2-Fassung, die Kampflos-Wörter kommen aus der vorhandenen Browserübersetzung.

`scripts/tts-walkover-plan.js` prüft Spielblockfolge, rechte Siegerseite, die
vollständige Position ohne „gegen“, Quellenbindung, Ausspracheidentität und den
Ergebniswortlaut. Neue Generierungen bleiben auf eine Kontextquelle je Stimme
beschränkt. Die 11 benötigten Spiel-/Teamstücke je Stimme stammen aus vorhandenen
Aufnahmen. Sieben waren bereits für die gemeinsame Wiedergabe aufbereitet; vier
weitere Doppel-Spielstücke bekommen erstmals dauerhafte Kopien mit denselben
100-ms-/LUFS-Regeln. Originale, Schnitte und bereits bestätigte Wiedergabestücke
bleiben erhalten. Es entsteht kein neuer Spielblock und keine neue Teamquelle.

Pausenziele sind 300 ms nach dem Spielblock und 100 ms zwischen Kampflos-Klausel
und Siegerteam einschließlich Randstille; innere Spielblockübergänge bleiben
erhalten. Es gibt zwölf Proben: je Stimme zwei vollständige D12, zwei kurze
Ergebnissätze, die gemeinsame Klausel und die Kontextreferenz.

Beide Quellen bestehen die Pausenprüfung mit Seed 42. Bei der Hallensprecherin
verhindert die etwa 930 ms lange Satzpause vor „Das Spiel …“ zunächst den
generischen Schnitt. Ein ausschließlich im v2-Labor verwendeter Schnitt bestätigt
die vollständige Klausel und beide Nachbarwörter in zwei Erkennungen und schneidet
in echter Stille vor dem Wortanfang; keine neue Synthese und keine übernommenen
historischen Frames. Der so bestimmte Schnitt bleibt zur Hörprüfung markiert.
Bei beiden Stimmen liegt das Ende von „an“ in aktiver Sprache und wird zusätzlich
markiert. Der Betreiber hat die aktuellen Einzel- und Doppelproben für beide
Stimmen bestätigt („Passt so!“), einschließlich des Übergangs von „an“ zum
Siegerteam. Die Bestätigung gilt diesen konkreten Aufnahmen; automatische
Schnittbefunde bleiben als Herkunftsinformation erhalten. Wiederholungsläufe
brauchen keine Synthese; produktive v1, Browsertexte und Turnierergebnisse
bleiben unverändert.

### 5.0.5 Anmeldung: vier Aufrufarten mit zwei Zielorten

Hörseite: `http://127.0.0.1:8084/anmeldung/`. Der wieder geöffnete Anmeldebereich
verwendet exakt die Wörter der vorhandenen Browserfunktion für Personen, Paarungen,
Vereine und Bundesländer, jeweils zur Anmeldung oder Turnierleitung. Der isolierte
Plan `scripts/tts-registration-plan.js` liest diesen Builder direkt aus und prüft
alle acht Montagen. Es gibt keine Änderung des produktiven freien Ansagepfads.

Je Stimme werden vier vollständige Kontextaufnahmen für zehn gemeinsame feste
Stücke und die beiden Positionsstücke eines Vereins-/Bundeslandlabels erzeugt.
Zwei bestehende vollständige Namen-/Teamstücke vor „spielt“ bleiben bytegleich.
Je Stimme stehen acht Montagen, 14 neue Einzelstücke und vier vollständige
Kontexte zum Vergleich bereit. PSV Bremen und Bremen sind gekennzeichnete
Hörbeispiele, keine Turnierzuweisungen. Details und Stückzählung stehen in
[Abschnitt 22.5 des Arbeitsdokuments](durchsagen-arbeitsdokument.md#225-erster-anmelde-hörsatz-mit-beiden-stimmen).

Der Betreiber hat den aktuellen Hörsatz für beide Stimmen klanglich bestätigt
(„Passt!“): alle vier Aufrufarten, beide Ziele und die Übergänge mit den vorhandenen
vollständigen Namen-/Teamstücken. Die Anmeldebausteine sind damit für diesen
Hörstand abgenommen; automatische Schnittbefunde bleiben erhalten.

### 5.1 Erster B01-Hörsatz: Spielfeld acht, beide Stimmen

`scripts/tts-field-context-plan.js` ergänzt den gespeicherten, bestätigten Spielblockplan um genau eine vollständige Feldreferenz pro Feld und Stimme. Für diesen ersten Hörtest wird nur Feld acht verwendet. Die Referenz hält die Spielnummer ohne „Nummer“, Satzzeichen und Doppel-Leerzeichen aus der bisherigen festen Vorlage bei; für v2 gilt die bereits gewählte gesprochene Schreibweise `Mädchen Einzel`. Die archivierte v1-Referenz bleibt unverändert.

```text
Auf Spielfeld acht! Spiel einhundertneunundachtzig.  Mädchen Einzel U neunzehn.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz. Auf Spielfeld acht!
```

Aus dieser einen Quelle je Stimme werden **B01-Anfang** und **B01-Ende** als unterschiedliche Positionsbausteine gewonnen. Die vollständige Quelle bleibt zusätzlich als pegelangeglichene Hörreferenz verfügbar. Beide Feldstücke umschließen in den Testmontagen die vorhandenen Spielblöcke; deren Texte, Audiobausteine und innere Pausenziele bleiben erhalten. An den zwei äußeren Übergängen gilt zunächst ein Ziel von 250 ms einschließlich vorhandener Randstille. Die Testaufrufe enthalten noch keine Offiziellen.

Je Stimme gibt es neun Proben: zwei Feldstücke, eine vollständige Kontextreferenz und die drei bestehenden Spiele mit jeweils zwei Begegnungsmontagen. Die Seiten `feldansagen/` und `feldansagen-hallensprecherin/` im Hörpaket verlinken einander und bieten die Quelle, jeden Ausschnitt sowie den zusammengebauten Aufruf an. Die Klangabnahme dieser neuen Feldstücke steht noch aus.

Der männliche Lauf erzeugte eine neue Quelle mit 158 Zeichen und 11,8 Sekunden Roh-Audio in 36,87 Sekunden Inferenz, der weibliche dieselben 158 Zeichen mit 16,0 Sekunden Roh-Audio in 47,07 Sekunden Inferenz. Pro Stimme werden 13 Quellen und 19 bestehende Spielblockbausteine aus dem Cache wiederverwendet. Die neuen Feldschnitte liegen an den jeweils erkannten Satzpausen; keine Frames wurden von der anderen Stimme oder historischen Aufnahmen übernommen. Die Plangenerierung verändert weder den bestätigten Ausgangsplan noch die vorhandenen Audiobausteine. Neue oder geänderte Feldnummern benötigen nur ihre eigenen fehlenden Feldquellen, keine neuen Spielblöcke.

Der reine Cache-Test verwendet je Stimme alle 14 Quellen und 22 Wiedergabestücke erneut, ohne Synthese, neue Schnittverarbeitung oder Modellladen. Alle neun Montagen beziehungsweise Einzelproben und ihre Hörkopien bleiben bytegleich. Chrome prüft beide Stimmen, die drei Aufrufe in Abspielfolge, die Feldstücke, den Referenzplayer, beide Begegnungsmontagen, manuelles Stoppen sowie alle Quellen- und Stimmenlinks.
