# BTS-Kontextstrategie v2 – gemeinsame Festlegungen

Diese Datei hält die schrittweise festgelegte neue BTS-Strategie fest. Sie beschreibt den vorgesehenen automatischen Aufbau im BTS; dafür ist keine Bedienung des Kontexteditors vorgesehen. Die bereits gesicherte und laufende v1 bleibt bis zur Umsetzung der neuen Strategie der dokumentierte bisherige Stand. Das [v1-Arbeitsdokument](durchsagen-arbeitsdokument.md) und die [gemessenen v2-Versuche](context-v2-experiments.md) bleiben getrennt nachvollziehbar.

## 1. Festgelegt: eine Kontextaufnahme je tatsächlichem Team

Für jedes Team wird dieser vollständige Kontext erzeugt:

```text
[Team] gegen [Team]
```

Beide Vorkommen enthalten **dasselbe Team**. Die Quelle enthält weder einen anderen Gegner noch eine Spielnummer, ein Feld, eine Disziplin oder eine Runde.

- **Einzel:** `[Team]` ist der vollständige Spielername.
- **Doppel und Mixed:** `[Team]` enthält beide vollständigen Spielernamen mit „und“, in der tatsächlichen Teamreihenfolge. Die Namen werden nicht in Vor-/Nachnamen oder Einzelwörter zerlegt.
- Nur tatsächlich vorkommende Teams werden berücksichtigt. Es werden keine hypothetischen Paarungen gebildet. Ein noch unvollständiges Team wird nicht durch erfundene Namen ergänzt.
- Dasselbe Team in mehreren Spielen verwendet dieselbe passende Kontextaufnahme. Gegnerwechsel, Spielnummer und Feldzuweisung erzeugen keine zusätzliche Teamaufnahme.
- Spielt eine Person mit unterschiedlichen Partnern, sind das unterschiedliche Teams und entsprechend unterschiedliche Kontexttexte.
- Die einmalige Generierung gilt jeweils für die gewählte Stimme, Modell-/Synthesekonfiguration und Ausspracheversion. Ein passender vorhandener Quellcache wird wiederverwendet.

Beispiele für die Quellen:

```text
Johann Bjarne Schöttmer gegen Johann Bjarne Schöttmer

Milo Ebeling und Adrian Kranig gegen Milo Ebeling und Adrian Kranig
```

Die vorhandenen BTS-Ausspracheersetzungen und die Zahlenausschreibung werden vor der Übergabe an den Sprachserver angewendet. Die Anzeige der Namen bleibt davon getrennt. Die obige Formel wird so festgehalten, wie sie vorgegeben wurde; zusätzliche Satzzeichen sind hier noch nicht vereinbart. Die bisherigen Laborbeispiele mit abschließendem Punkt bleiben als eigene Referenzen erhalten und werden nicht stillschweigend zu dieser Quelle umbenannt.

## 2. Team-Ausschnitte und Verwendung im Hörtest

Die Quelle stellt beide Teampositionen mit dem gesprochenen Verbinder „gegen“ bereit. Die möglichen Bereiche sind:

```text
Team an erster Position | gegen | Team an zweiter Position
```

Für die angeforderten Spielblock-Hörproben werden zwei Montagen **derselben** Quellen verglichen: `Team 1 mit gegen → Team 2` sowie `Team 1 → gegen → Team 2`. Dafür werden keine zusätzlichen Namen oder Begegnungen isoliert generiert. Beide Positionen behalten ihre eigene Herkunft und Betonung, obwohl ihr Text identisch ist. Die Auswahl der endgültigen Montage und der Pausen bleibt vom Hörvergleich abhängig.

Schnittgrenzen beziehen sich immer auf die tatsächlich erzeugte Original-WAV und ihren Hash. Ein sicherer Schnitt wird nicht aus der Zeichenlänge oder aus festen Zeiten einer anderen Aufnahme abgeleitet. Vollständige Namen und leise An-/Auslaute müssen erhalten bleiben.

## 3. Festgelegt: die übrigen Teile des Spielblocks

| Teil | Vollständige Generierung | Verwendung |
| --- | --- | --- |
| B03 Spielnummer | `Spielnummer [Nummer] ist als nächstes an der Reihe.` | Nur `Spielnummer [Nummer]` ausschneiden; der Nachsatz wird nicht abgespielt |
| B04 Disziplin und Altersklasse | `Im [Disziplin] [Altersklasse] erwarten wir spannende Spiele!` | Nur `[Disziplin] [Altersklasse]` ausschneiden; „Im“ und der Nachsatz werden nicht abgespielt |
| B05 Runde | `[Runde]!` | Direkt und vollständig abspielen; das Ausrufezeichen entspricht zunächst dem bisherigen Beispiel |
| B07 Begegnung | Je tatsächlichem Team: `[Team] gegen [Team]` | Erste Position von Team 1, Verbinder „gegen“, zweite Position von Team 2; alternativ Team 1 und Verbinder als gemeinsames Stück |

Damit ergibt sich:

```text
Spielnummer [Nummer].
→ [Disziplin] [Altersklasse]!
→ [Runde]!
→ [Team 1] gegen [Team 2]
```

Spielnummern werden je Nummer, Disziplinen je Kombination mit Altersklasse und Runden je gesprochenem Rundentext dedupliziert. Für denselben Spielblock auf einem anderen Feld ist keine neue Generierung nötig. Zahlen werden vor der Synthese ausgeschrieben; die Anzeige behält Ziffern. Aktuelle Ausspracheersetzungen werden angewendet. Die Quelle für B04 enthält echte Umlaute, etwa „Mädcheneinzel“.

Für B03 steht nach der Nummer innerhalb des Kontextsatzes **kein zusätzlicher Punkt**. Der Ausschnitt endet vor „ist“, damit er die im Satz erzeugte Betonung behält. Die angezeigte Spielblockfassung darf weiterhin einen Punkt nach der Spielnummer zeigen; die Pause zwischen B03 und B04 wird bei der Montage gesetzt.

Für B04 steht nach der Altersklasse ebenfalls **kein zusätzliches Satzzeichen** im Kontextsatz. Der Ausschnitt beginnt nach „Im“ und endet vor „erwarten“. Das abschließende Ausrufezeichen gehört nur zur vollständigen Kontextaufnahme; die Pause zur Runde entsteht bei der Montage. Die angezeigte Spielblockfassung behält ihr bisheriges Ausrufezeichen nach der Altersklasse.

### Angeforderte Hörproben

`scripts/tts-gameblock-context-plan.js` erzeugt den isolierten Hörplan aus dem privaten Turnierexport. Er enthält das bekannte Beispielspiel 189 (nicht das tatsächlich im Export gespeicherte Spiel 189) sowie die tatsächlichen Spiele 161 und 381 als weiteres Einzel und Doppel. Alle drei sind Achtelfinals.

- Drei Spielnummern, drei Kombinationen aus Disziplin und Altersklasse, **eine** gemeinsame Runde und sechs Teamkontexte ergeben **13 vollständige Quellaufnahmen**.
- Zwei Montagen je Spiel ergeben **sechs Hörproben**, ohne zusätzliche Synthese für die Vergleichsmontage.
- Die Testpausen betragen 250 ms zwischen Spielnummer, Disziplin, Runde und Begegnung sowie 60 ms an den Übergängen innerhalb der Begegnung. Vorhandene Randstille wird angerechnet. Diese Werte sind zunächst Hörtest-Einstellungen.
- Gesprochen wird mit Hallensprecher, Seed 42 und dem bisherigen Wiedergabetempo 1,155. Kein Kontexttext wird stellvertretend als kürzerer Generierungsaufwand gezählt.

Die fertige private Hörseite liegt im vorhandenen Hörpaket unter `spielbloecke/`. Sie bietet beide Montagen, eine Abspielfolge der drei Spiele sowie pro Baustein Quelltext, Originalaufnahme, Schnittdaten und den einzelnen Ausschnitt. Ein unsicherer Schnitt bleibt als solcher gekennzeichnet. Audiodateien und der private Turnierexport werden nicht in Git aufgenommen.

Der tatsächliche Versuch vom 17. Oktober 2026 hat alle 13 Quellen erzeugt. Nach einer Korrektur der Positionszuordnung bei identischen Teamwiederholungen sind alle sechs Montagen verfügbar; dafür wurde keine Quelle erneut synthetisiert. Beim Doppel bleibt die aktiv gesprochene Grenze nach „gegen“ in beiden Montagen als Hörprüfstelle markiert. Ein weiterer reiner Cache-Lauf verwendet sämtliche Quellen und 19 Wiedergabestücke ohne neue Synthese und ohne Modellladen wieder.

Anschließend wurde B03 auf den oben beschriebenen Kontextsatz umgestellt. Dafür brauchen die drei Beispielnummern jeweils eine neue Kontextaufnahme; die zehn anderen Quellen passen weiterhin zum vorhandenen Cache. Die Hörseite `spielbloecke/` verwendet den neuen Aufbau. Der bisherige Vergleich mit direkt erzeugter Spielnummer bleibt unter `spielbloecke-direkte-spielnummer/` erhalten.

Die folgende Anpassung von B04 verwendet den oben beschriebenen Satz „Im … erwarten wir spannende Spiele!“. Dafür werden nur die drei Disziplin-/Altersklassenquellen neu erzeugt; Nummern, Runde und Teams bleiben wiederverwendbar. Die bisherige Fassung mit „Wir rufen auf:“ bleibt unter `spielbloecke-wir-rufen-auf/` erhalten, die aktuelle Fassung liegt weiterhin unter `spielbloecke/`.

## 4. Bezug zum bisherigen Aufbau

Aktuell gewinnt `static/js/speech_context.js` die Team-Ausschnitte aus dem vollständigen tatsächlichen Spielblock (`gamePieces` / `teamPiece`). Die neue Festlegung ersetzt für die künftige v2-Teamquelle diese Bindung an den jeweiligen Spielgegner durch den wiederholten eigenen Teamkontext. Sie schaltet noch nicht eigenständig die gesamte Strategie um; der übrige Aufbau und die genaue Schnittverwendung werden weiter festgelegt.

Der Sprachserver unterstützt bereits vollständige Kontextquellen und quellengebundene Ausschnitte. Die spätere BTS-Planung muss passende Quellen deduplizieren, ihre Positionsausschnitte referenzieren und weiterhin nur einen Sprachserverauftrag zur Zeit senden. Die bestehende Priorisierung wird durch diese Festlegung nicht neu geordnet. Die Anwesenheitskontrolle bleibt außerhalb des Umfangs.
