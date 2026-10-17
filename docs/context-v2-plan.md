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

## 2. Noch festzulegen: Ausschnitte und Verwendung

Die Quelle stellt beide Teampositionen mit dem gesprochenen Verbinder „gegen“ bereit. Wie diese Aufnahme genau geschnitten und für die einzelnen Durchsagen verwendet wird, wird im nächsten Schritt festgelegt. Die möglichen Bereiche sind:

```text
Team an erster Position | gegen | Team an zweiter Position
```

Auch die Bündelung des ersten Teams mit „gegen“ ist technisch möglich; daraus folgt noch keine neue Festlegung der Wiedergabestücke. Es werden hier weder zusätzliche isolierte Namensgenerierungen noch bestimmte Pausen beschlossen. Beide Positionen müssen ihre eigene Herkunft und Betonung behalten, obwohl ihr Text identisch ist.

Schnittgrenzen beziehen sich immer auf die tatsächlich erzeugte Original-WAV und ihren Hash. Ein sicherer Schnitt wird nicht aus der Zeichenlänge oder aus festen Zeiten einer anderen Aufnahme abgeleitet. Vollständige Namen und leise An-/Auslaute müssen erhalten bleiben.

## 3. Bezug zum bisherigen Aufbau

Aktuell gewinnt `static/js/speech_context.js` die Team-Ausschnitte aus dem vollständigen tatsächlichen Spielblock (`gamePieces` / `teamPiece`). Die neue Festlegung ersetzt für die künftige v2-Teamquelle diese Bindung an den jeweiligen Spielgegner durch den wiederholten eigenen Teamkontext. Sie schaltet noch nicht eigenständig die gesamte Strategie um; der übrige Aufbau und die genaue Schnittverwendung werden weiter festgelegt.

Der Sprachserver unterstützt bereits vollständige Kontextquellen und quellengebundene Ausschnitte. Die spätere BTS-Planung muss passende Quellen deduplizieren, ihre Positionsausschnitte referenzieren und weiterhin nur einen Sprachserverauftrag zur Zeit senden. Die bestehende Priorisierung wird durch diese Festlegung nicht neu geordnet. Die Anwesenheitskontrolle bleibt außerhalb des Umfangs.
