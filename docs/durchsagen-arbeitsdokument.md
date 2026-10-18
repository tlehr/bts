# BTS-Durchsagen – Arbeitsdokument

Stand: 16.10.2026 · Branch: `feat/localTts`

Diese Datei ist unsere gemeinsame Grundlage, um Wortlaut, Reihenfolge und Stückelung der Turnierdurchsagen zu bearbeiten. Die Kennungen D01–D15 und B01–B12 bleiben bei Überarbeitungen erhalten, damit wir einzelne Stellen eindeutig benennen können.

Die Anwesenheitskontrolle war zunächst ausgeklammert; Abschnitt 22 ergänzt jetzt ihre Bestandsaufnahme und einen v2-Planungsentwurf. Die Datei beschreibt den aktuellen Programmstand, hält in Abschnitt 7.1 und 7.2 unsere Vereinbarungen fest und plant in Abschnitt 7.3 die übrigen Ansagen nach derselben Logik. Der vereinbarte Kontextaufbau ist jetzt in BTS und Sprachserver umgesetzt, einschließlich der Korrekturen für D05, D08 und D12. [Betrieb, Verarbeitung und Prüfungen](context-tts.md) beschreiben den implementierten Stand. Weitere Änderungen dieser Datei werden ausdrücklich in die Anwendung übertragen; BTS liest diese Markdown-Datei nicht als Konfiguration. Die Klangabnahme weiterer Namen und Kombinationen bleibt ein Hörtest.

## 1. Ziel und bisherige Hörentscheidung

- Möglichst lange, natürlich klingende Satzstücke verwenden.
- Wiederholte Inhalte möglichst aus bereits erzeugten Aufnahmen abspielen.
- So wenig wie möglich und so viel wie nötig generieren. Bereits passende Aufnahmen werden wiederverwendet.
- Den gesprochenen Inhalt zunächst erhalten; die Stückelung darf sich ändern.
- Vollständige Namen zusammenhalten. Übergänge zwischen Namen, „und“ und „gegen“ sollen natürlich klingen.
- Zahlen vor der lokalen Synthese ausschreiben; in der Anzeige bleiben Ziffern erhalten.
- Für Browser-TTS und lokale Generierung dürfen unterschiedliche Strategien verwendet werden.
- Klangliches Ziel ist der deutlich bevorzugte zusammenhängende Hörtest **Variante 1**.

Im Hörtest **Variante 5** wurde die separat erzeugte Spielfeldansage als unnatürlich bewertet. **Variante 6** übernimmt deshalb Anfangs- und Schlussansage aus Variante 1 und setzt den Spielblock aus Variante 5 dazwischen. Diese Aufnahme steht zum Vergleich bereit. Die vereinbarte Erstellung von B01-Anfang und B01-Ende für alle Felder greift dieses Vorgehen auf (Abschnitt 7.1); ihre Umsetzung für den Turnierbetrieb ist mit der serverseitig angebotenen Strategie `bts-context-v1` verfügbar.

Der Hörtest und der festgelegte Referenzaufruf verwenden „Spiel 189.“ beziehungsweise die ausgeschriebene Fassung ohne „Nummer“. Die produktive deutsche Vorlage lautet derzeit „Spiel Nummer 189!“. Der festgelegte Referenztext in Abschnitt 7.1 bleibt unabhängig von dieser produktiven Vorlage wortgetreu erhalten.

## 2. Schreibweise in dieser Datei

`{Feld}`, `{Nummer}`, `{Name}` und ähnliche Angaben sind Platzhalter für Turnierdaten. Sie werden nicht wörtlich gesprochen.

`→` trennt die vom heutigen Textaufbau gelieferten Ansageabschnitte. Es ist kein gesprochenes Zeichen und legt noch keine künftige Aufnahmegrenze fest. Ein heutiger Abschnitt kann bei lokaler Wiedergabe aus mehreren kleineren Aufnahmen bestehen.

`+` bezeichnet direktes Zusammensetzen von Texten. Es fügt selbst weder Leerzeichen noch Satzzeichen ein. Wo die aktuellen Vorlagen beispielsweise `Schiedsrichter:{Name}` ergeben, bleibt das hier sichtbar. Die Darstellung ist keine bereits überarbeitete Sprechfassung.

Ein leerer oder ausgeschalteter optionaler Baustein entfällt. Ein fehlendes Spielfeld lässt die Feldansage entfallen.

## 3. Gemeinsame Textbausteine im aktuellen Aufbau

| Kennung | Bedeutung | Heutiger Text beziehungsweise Aufbau |
| --- | --- | --- |
| B01 | Feldansage | `Auf Spielfeld {Feld}!` |
| B02 | Feld für ein vorbereitetes Spiel | `Für Spielfeld {Feld}!` |
| B03 | Spielnummer | `Spiel Nummer {Nummer}!` |
| B04 | Disziplin und Altersklasse | Aus dem Disziplinkürzel und dem Zusatz im Veranstaltungsnamen, z. B. `Jungeneinzel U17` |
| B05 | Runde | Z. B. `Achtelfinale`, `Viertelfinale`, `Halbfinale`, `Finale`, `Zwischenrunde` oder Platzierungsrunde |
| B06 | Ein Team | Einzel: `{Name 1}`; Doppel: `{Name 1} und {Name 2}` |
| B07 | Beide Teams | `{Team 1}, gegen {Team 2}` |
| B08 | Zugeordnete Offizielle | `Schiedsrichter:{Name}` → `Aufschlagrichter:{Name}` → `Tabletbedienung:{Name/n}`; alternativ `Klapptafelbedienung:{Name/n}` |
| B09 | Vorbereitung | `In Vorbereitung` + gegebenenfalls ` ` + `{Hallenzusatz}` |
| B10 | Treffpunkt | Der hinterlegte hallenbezogene Treffpunkttext; ohne passende Halle der Standard `Treffen am Meetingpoint!` |
| B11 | Präfixe für Zweitaufrufe | Normal: `Zweiter Aufruf für:`; Vorbereitung: `Zweiter Aufruf In Vorbereitung für:` |
| B12 | Beginn des Spiels | `Bitte mit dem Spielen beginnen!` |

**Festgelegte Zusammensetzung des Spielblocks**, in dieser Reihenfolge:

```text
B03 Spielnummer
→ B04 Disziplin / Altersklasse
→ B05 Runde
→ B07 Beide Teams
```

Für die geplante lokale Ausgabe wird dieser Spielblock **je Spiel als eine zusammenhängende Aufnahme** mit den tatsächlichen Teams erzeugt. Daraus werden zusätzlich beide Teams einzeln ausgeschnitten, jeweils **ohne „gegen“** (Abschnitt 7.2). Der vollständige Spielblock bleibt für die reguläre Wiedergabe erhalten.

Die Offiziellen B08 stehen bei regulären Spiel- und Vorbereitungsaufrufen anschließend in der Reihenfolge Schiedsrichter, Aufschlagrichter, Bedienung. Es werden nur die jeweils zugeordneten Rollen ausgegeben. Die Bedienung kann einen oder zwei Namen enthalten.

### 3.1 Disziplinen und Runden

Die aktuellen deutschen Disziplintexte sind:

| Kürzel | Aktueller Text |
| --- | --- |
| JE | `Jungeneinzel` |
| JD | `Jungendoppel` |
| ME | `Mädcheneinzel` |
| MD | `Mädchendoppel` |
| GD / MX | `Gemischtes Doppel` |
| HE | `Herreneinzel` |
| HD | `Herrendoppel` |
| DE | `Dameneinzel` |
| DD | `Damendoppel` |
| E | `Einzel` |
| D | `Doppel` |

Die deutschen Sprachvorlagen verwenden `Mädcheneinzel` und `Mädchendoppel`, jeweils mit Umlaut und ohne zusätzliches „n“. Der Alters-/Klassenzusatz kommt aus dem Veranstaltungsnamen hinzu. Vorhandene Ausspracheersetzungen für Namen werden ebenfalls berücksichtigt.

Bei den Runden werden `R16`, `VF`, `HF` und `Finale` in die entsprechenden Rundennamen übersetzt. Eine Bezeichnung mit Bindestrich ergibt `Zwischenrunde`. Platzierungsangaben mit `/` werden abhängig vom Abstand als „Runde um Platz … bis …“ oder „Spiel um Platz … und …“ aufgebaut. Im aktuellen Code fehlen dabei teilweise Leerzeichen: Beispielsweise ergeben `1/4` und `3/4` die Texte `Runde um Platz1bis4` und `Spiel um Platz3 und 4`. Andere nicht erkannte Rundennamen ergeben einen leeren Rundentext.

### 3.2 Einstellbare Varianten

- Spielnummer B03, Disziplin B04 und Runde B05 lassen sich jeweils ausschalten.
- Die Halle kann einen eigenen Vorbereitungszusatz und einen eigenen Treffpunkttext haben. Bei D02 wird ein leerer oder ausgeschalteter Treffpunkt durch den Abschluss `Das Spiel ist in Vorbereitung!` ersetzt; der gespeicherte Treffpunkttext bleibt dabei erhalten.
- Hallentexte können mit `{Einzahl/Mehrzahl}` unterschiedliche Ansprachen enthalten, beispielsweise `Bitte {melde dich/meldet euch} bei der Turnierleitung!`.
- Der vollständige Vorbereitungsaufruf spricht beide Seiten gemeinsam an und verwendet die Mehrzahl. Ein gezielter Team-Zweitaufruf verwendet bei einem Spieler die Einzahl, bei zwei Spielern die Mehrzahl.
- Schiedsrichter und Aufschlagrichter werden beim gezielten Vorbereitungs-Zweitaufruf in der Einzahl angesprochen. Bei der Bedienung richtet sich die Form nach der Zahl der zugeordneten Personen.
- Die Freigabe der Spiel- und Vorbereitungsansagen wird je Halle am ausgebenden Client gesteuert. Diese Freigabe ändert die Textvorlage nicht.

## 4. Spielbezogene Durchsagen

### D01 – Spielaufruf

Auslöser: Spiel wird auf ein Feld aufgerufen; derselbe Aufruf kann manuell wiederholt werden.

```text
B01 Auf Spielfeld {Feld}!
→ Spielblock
→ B08 Zugeordnete Offizielle
→ B01 Auf Spielfeld {Feld}!
```

Die Spielfeldansage steht am Anfang und am Ende. Der aktuelle lokale Aufbau verwendet dafür dieselbe Aufnahme; im Kontext-Hörtest 6 stammen Anfang und Ende aus unterschiedlichen Stellen derselben vollständigen Referenz.

Für die geplante lokale Fassung ist vereinbart: Am Anfang wird **B01-Anfang** des jeweiligen Feldes verwendet, danach der **vollständige Spielblock des Spiels**, am Schluss **B01-Ende** desselben Feldes. Die Offiziellen bleiben zwischen Spielblock und Schlussansage; der neue Planungsentwurf verwendet dafür vollständige Rollen-/Namensaufnahmen (Abschnitt 7.3). Erstellung und Wiederverwendung der Feldaufnahmen sind in Abschnitt 7.1 festgelegt, die der Spielblöcke und Team-Ausschnitte in Abschnitt 7.2.

### D02 – Vorbereitungsaufruf

Auslöser: Ein Spiel wird in Vorbereitung aufgerufen.

```text
B09 In Vorbereitung {Hallenzusatz}
→ B02 Für Spielfeld {Feld}!
→ Spielblock
→ B08 Zugeordnete Offizielle
→ B10 Treffpunkt
```

Ohne aktivierte Treffpunktfunktion oder bei leerem Treffpunkttext lautet der Abschluss stattdessen `Das Spiel ist in Vorbereitung!`. Das gilt für Browser-TTS und beide lokalen Stimmen. Ein noch nicht zugewiesenes Feld lässt B02 entfallen.

Die geplante lokale Fassung verwendet denselben vollständigen Spielblock wie D01. Ein Vorbereitungsaufruf benötigt dafür keine zusätzliche Spielblock-Generierung.

### D03 – Bitte mit dem Spielen beginnen

Auslöser: Gezielte Aufforderung zum Spielbeginn.

```text
Auf Spielfeld {Feld}! Bitte mit dem Spielen beginnen!
```

**Vereinbarter lokaler Aufbau:**

```text
B01-Anfang des jeweiligen Feldes
→ B12 Bitte mit dem Spielen beginnen!
```

Der erste Teil verwendet die bereits aus dem vollständigen Referenzaufruf ausgeschnittene Aufnahme **B01-Anfang**. D03 benötigt dafür keine zusätzliche Generierung der Spielfeldansage. Der neue Planungsentwurf gewinnt B12 aus einem vollständigen Beispiel für D03 (Abschnitt 7.3). Die Übergangspause wird im Hörvergleich abgestimmt.

Ohne Feldzuweisung bleibt nur `Bitte mit dem Spielen beginnen!`.

### D04 – Zweiter Aufruf eines Teams auf das Feld

Auslöser: Zweiter Aufruf für Team 1 oder Team 2; beide haben getrennte Bedienelemente und dieselbe Vorlage.

```text
Zweiter Aufruf für:{Team}
→ Auf Spielfeld {Feld}!
```

Ein Doppelteam besteht aus beiden vollständigen Namen mit ` und `.

### D05 – Zweiter Vorbereitungsaufruf eines Teams

Auslöser: Zweiter Vorbereitungsaufruf für Team 1 oder Team 2.

```text
Zweiter Aufruf In Vorbereitung für:{Team} {Hallenzusatz}!
→ {Team} {Treffpunkttext in Einzahl oder Mehrzahl}
```

Der Hallenzusatz entfällt, wenn er nicht vorhanden ist. Ohne aktivierte Treffpunktfunktion wird im zweiten Abschnitt nur `{Team}` wiederholt. Eine Spielfeldansage gehört nicht zu dieser Vorlage.

### D06 – Zweiter Aufruf des Schiedsrichters

```text
Auf Spielfeld {Feld}! Zweiter Aufruf für:Schiedsrichter:{Name}
```

### D07 – Zweiter Aufruf des Aufschlagrichters

```text
Auf Spielfeld {Feld}! Zweiter Aufruf für:Aufschlagrichter:{Name}
```

### D08 – Zweiter Aufruf der Tablet-/Klapptafelbedienung

```text
Auf Spielfeld {Feld}! Zweiter Aufruf für:Tabletbedienung:{Name/n}
```

Bei aktivierter manueller Klapptafelbedienung lautet die Rolle `Klapptafelbedienung:`. Bei D06–D08 entfällt ohne Feldzuweisung der Anfang `Auf Spielfeld {Feld}! `.

### D09 – Zweiter Vorbereitungsaufruf des Schiedsrichters

```text
Zweiter Aufruf In Vorbereitung für:Schiedsrichter:{Name}!
→ {Name} {Treffpunkttext in Einzahl}
```

Ohne aktivierte Treffpunktfunktion lautet der zweite Abschnitt `{Name} In Vorbereitung!`.

### D10 – Zweiter Vorbereitungsaufruf des Aufschlagrichters

```text
Zweiter Aufruf In Vorbereitung für:Aufschlagrichter:{Name}!
→ {Name} {Treffpunkttext in Einzahl}
```

Ohne aktivierte Treffpunktfunktion lautet der zweite Abschnitt `{Name} In Vorbereitung!`.

### D11 – Zweiter Vorbereitungsaufruf der Tablet-/Klapptafelbedienung

```text
Zweiter Aufruf In Vorbereitung für:Tabletbedienung:{Name/n}!
→ {Name/n}, bitte als Tabletbedienung {abgeleiteter Meldezusatz}
```

Im ersten Abschnitt wird bei manuellen Klapptafeln die Rolle `Klapptafelbedienung:` verwendet. Im zweiten Abschnitt steht derzeit auch dann fest `bitte als Tabletbedienung`.

Bei aktiver Treffpunktfunktion wird der Meldezusatz derzeit so aufgebaut:

1. Treffpunkttext für eine oder mehrere Bedienpersonen wählen.
2. Die erste passende Zeichenfolge `bitte meldet euch ` beziehungsweise `Bitte meldet euch ` entfernen.
3. Das erste Ausrufezeichen entfernen.
4. Direkt `melden!` anhängen und diesen Zusatz mit einem Leerzeichen an den bisherigen zweiten Abschnitt setzen.

Diese Zusammensetzung kann unsaubere Formulierungen ergeben. Aus `Bitte melde dich bei der Turnierleitung!` wird beispielsweise der Zusatz `Bitte melde dich bei der Turnierleitungmelden!`. Ohne Treffpunktfunktion entfällt der Meldezusatz vollständig; der zweite Abschnitt endet bei `bitte als Tabletbedienung`.

### D12 – Kampflos-/Walkover-Mitteilung

Auslöser: Eine kampflose Entscheidung beziehungsweise ein Walkover wird mit feststehender unterlegener Seite eingetragen oder geändert. Für automatisch fortgesetzte kampflose Entscheidungen gibt es eine zusätzliche Turniereinstellung zur Ausgabe der Ansagen.

```text
Spiel Nummer {Nummer}, {Disziplin}, {Runde}!
→ {Team 1} gegen {Team 2}. Das Spiel geht kampflos an {Siegerteam}!
```

Ausgeschaltete Spielangaben entfallen. Die verbleibenden Angaben des ersten Abschnitts werden mit `, ` verbunden und gemeinsam mit `!` abgeschlossen. Sind alle drei ausgeschaltet, entfällt der erste Abschnitt vollständig.

Der Sieger kann Team 1 oder Team 2 sein. Im zweiten Abschnitt steht vor `gegen` hier kein zusätzliches Komma. Diese Vorlage enthält keine Spielfeldansage und keine Offiziellen. Die sichtbare Doppelung des Siegernamens gehört zum heutigen Wortlaut.

## 5. Weitere Ausgaben

### D13 – Freie Ansage

```text
{Eingegebener Text}
```

Die Oberfläche bietet das Abspielen auf diesem Gerät und das Senden an die freigegebenen Ansage-Clients. Diese Wahl ist unabhängig davon, ob der gewählte Sprachmodus lokale WAVs oder Browser-TTS nutzt. Die aktuellen Eingabefelder begrenzen den Text auf 175 Zeichen. Der abgesendete Text wird außen getrimmt und als vollständiger Text behandelt. Ein Entwurf kann bereits während des Eingebens vorbereitet werden.

### D14 – Sprachtest

```text
Dies ist ein Test der Sprachausgabe.
```

Der Test verwendet den gewählten Sprachmodus. Lokal wird der vollständige Testtext als eine Aufnahme vorbereitet.

### D15 – Evakuierungsdurchsage

Hier wird die bestehende Datei `static/audio/evakuierung.mp3` abgespielt. Die Aufnahme startet sofort und anschließend alle 20 Sekunden erneut, bis die Ausgabe gestoppt wird. Für diese Durchsage werden keine Sprachbausteine generiert.

## 6. Wie die Ausgabe derzeit zusammengesetzt wird

### 6.1 Gemeinsamer Textaufbau

Die Anwendung baut zunächst die oben beschriebenen Texte und Abschnitte. Dabei werden die tatsächliche Feldzuweisung, Teamnamen, Hallentexte, Offiziellen, Sprache und ausgeschalteten Spielangaben berücksichtigt. Die Textstruktur bleibt intern bekannt, auch wenn mehrere Teile zu einem Abschnitt zusammengesetzt werden.

### 6.2 Browser-TTS

Browser-TTS erhält die bisherigen vollständigen Ansageabschnitte. Beispielsweise ist die gesamte Teamansage `{Team 1}, gegen {Team 2}` ein solcher Abschnitt. Die lokalen Aussprache-/Stückelungsversuche aus dem Hörlabor sind noch keine neue Browserstrategie.

### 6.3 Lokale Sprachausgabe im Turnierbetrieb

Der bisherige lokale Plan für Server ohne Kontextverarbeitung zerlegt die Abschnitte anhand ihrer bekannten Struktur weiter. Bei `bts-context-v1` gilt der längere Aufbau aus Abschnitt 7. Die folgende Tabelle zeigt die sichtbaren Bausteintexte vor dem Ausschreiben der Zahlen für die Synthese:

| Gesprochener Abschnitt | Aktuelle lokale Bausteintexte |
| --- | --- |
| `Auf Spielfeld 8!` | `Auf Spielfeld 8` |
| `Auf Spielfeld 8! Bitte mit dem Spielen beginnen!` | `Auf Spielfeld 8` + `Bitte mit dem Spielen beginnen` |
| `{Name A}, gegen {Name B}` | `{Name A}` + `gegen` + `{Name B}` |
| `{Name A} und {Name B}` | `{Name A}` + `und` + `{Name B}` |
| `Schiedsrichter:{Name}` | `Schiedsrichter` + `{Name}` |

Strukturelle Satzzeichen werden überwiegend als Wiedergabegrenzen behandelt, statt zusätzliche Aufnahmen desselben Texts mit Punkt, Komma oder Ausrufezeichen zu erzeugen. Namensinterne Zeichen wie Initialen bleiben erhalten. Der Plan setzt nach Satzschlusszeichen 250 ms, nach Komma, Semikolon oder Doppelpunkt 120 ms und sonst keine zusätzliche Grenzpause an. Audioclips können eigene Pausen enthalten; weitere Wiedergabeeinstellungen beeinflussen den tatsächlichen Ablauf.

Die lokale Anfrage schreibt Zahlen aus, während die Liste im BTS weiterhin die Ziffern zeigt. Gleiche Texte derselben Stimme und Synthesekonfiguration verwenden vorhandene Aufnahmen. So wird beispielsweise `Spiel Nummer 189` beim normalen Spielaufruf und bei der kampflosen Entscheidung wiederverwendet; die unterschiedlichen Satzgrenzen gehören zur Wiedergabe.

BTS behält die Warteschlange und schickt höchstens einen offenen Generierungsauftrag an den Sprachserver. Tatsächliche Aufrufe haben Vorrang vor unmittelbar bevorstehenden und weiter entfernten Vorbereitungen. Für ein Turnier wird nur die zentral gewählte lokale Stimme vorbereitet. Abspielen und Vorbereiten sind getrennte Vorgänge.

### 6.4 Bisheriger Hörversuch mit längeren Stücken

| Versuch | Aufbau | Stand |
| --- | --- | --- |
| Variante 1 | Vollständige Beispieldurchsage in einer Aufnahme | Klanglicher Favorit |
| Variante 5 | Separat erzeugte Feldansage + vollständiger Spielblock ohne Feld + dieselbe Feldansage | Feldansage als unnatürlich bewertet |
| Variante 6 | Feldansage vom Anfang der Variante 1 + Spielblock aus Variante 5 + Feldansage vom Ende der Variante 1 | Hörprobe vorhanden; keine allgemeine Umstellung |

Variante 6 zeigt einen Weg zur Wiederverwendung von im Zusammenhang erzeugten Teilen. Die geprüften Schnittstellen gehören ausschließlich zu der konkreten Referenz-WAV. Für andere Texte und Aufnahmen müssen passende Grenzen ermittelt werden. Allein das Ändern von Satzzeichen oder eines Seeds garantiert keine gleiche Betonung bei anderer Stückelung.

## 7. Vereinbarungen und offene Entscheidungen

### 7.1 Festgelegt: Zuerst B01-Anfang und B01-Ende für alle Felder

Die erste Vorbereitungsstufe erstellt die beiden Spielfeldaufnahmen für **alle im Turnier angelegten Felder**. Sie verwendet die zentral ausgewählte lokale Stimme.

| Aufnahme | Gesprochener Text | Herkunft | Vereinbarter Einsatz |
| --- | --- | --- | --- |
| B01-Anfang je Feld | `Auf Spielfeld {Feld}!` | Anfang eines vollständig erzeugten Referenz-Spielaufrufs für dieses Feld | Beginn von D01 und erster Teil von D03 |
| B01-Ende je Feld | `Auf Spielfeld {Feld}!` | Ende derselben vollständigen Aufnahme | Abschluss von D01 |

**Erstellung je Feld:**

1. Einen vollständigen Referenz-Spielaufruf nach der unten festgelegten Vorlage mit der jeweiligen Feldnummer am Anfang und Ende erzeugen. Die Spielfeldansagen entstehen dabei im Zusammenhang der gesamten Durchsage.
2. Die erste Spielfeldansage sauber ausschneiden und als B01-Anfang dieses Feldes speichern.
3. Die letzte Spielfeldansage aus derselben Aufnahme ausschneiden und als B01-Ende dieses Feldes speichern.
4. Beide Ausschnitte für spätere Aufrufe aus dem Cache verwenden. Für die zweite Position wird kein weiterer vollständiger Spielaufruf erzeugt.

**Festgelegter Mittelteil für sämtliche Felder:**

```text
Spiel einhundertneunundachtzig.  Mädcheneinzel U neunzehn.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz.
```

Dieser Beispiel-Spielblock bleibt immer gleich. Er muss keinem tatsächlichen Turnierspiel entsprechen. Schreibweisen, Satzzeichen und die beiden Doppel-Leerzeichen nach den ersten beiden Punkten bleiben exakt erhalten. Insbesondere bleiben `LeandraGalowicz` zusammengeschrieben und `Spiel einhundertneunundachtzig.` ohne das Wort „Nummer“.

**Vollständige Quellaufnahme je Feld:**

```text
Auf Spielfeld {Feld}! Spiel einhundertneunundachtzig.  Mädcheneinzel U neunzehn.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz. Auf Spielfeld {Feld}!
```

Beim Senden an den Sprachserver wird auch die jeweilige Feldnummer ausgeschrieben. Nur die Feldangaben am Anfang und Ende ändern sich zwischen den Referenzaufnahmen. Es werden keine Offiziellen oder zusätzlichen Angaben angehängt.

Die gewünschten Ausschnitte sind:

```text
Auf Spielfeld {Feld}! → {vollständiger Mittelteil des Referenzaufrufs} → Auf Spielfeld {Feld}!
└──── B01-Anfang ────┘                                                 └──── B01-Ende ────┘
```

Bei N Feldern und vollständig leerem Cache entstehen damit **N vollständige Generierungen und 2 × N wiederverwendbare Feldaufnahmen**. Beispielsweise ergeben 16 Felder 16 vollständige Generierungen und 32 Ausschnitte. Bereits passende Aufnahmen werden weiterverwendet; ein Neustart allein soll keine erneute Generierung auslösen.

Anfang und Ende sind trotz identischen Wortlauts zwei unterschiedliche Cache-Bausteine. Ihre Betonung stammt aus der jeweiligen Position im vollständigen Aufruf. Die spätere Änderung eines Gegners, einer Spielnummer oder einer Runde erfordert keine erneute Erzeugung dieser vorhandenen Feldaufnahmen. Ein neues Feld benötigt seine beiden Aufnahmen; eine andere Stimme oder Synthesekonfiguration benötigt dazu passende Aufnahmen.

Die Schnittstellen müssen für jede Quellaufnahme ermittelt werden, damit keine Wortenden abgeschnitten oder benachbarte Wörter mit übernommen werden. Die festen Zeiten des bisherigen Feld-8-Hörtests sind keine allgemeine Schnittvorgabe. Quellaufnahme und Schnittinformationen bleiben als Herkunft der Ausschnitte erhalten.

**Noch offen:** Ob und wie wir aus den Referenzaufnahmen zusätzlich andere Bausteine gewinnen, legen wir bei den nächsten Schritten fest. B02 („Für Spielfeld …!“) wird getrennt als vollständiger Satz je Feld erzeugt; die aktuelle Festlegung steht in Abschnitt 23.

### 7.2 Festgelegt: Ein vollständiger Spielblock je Spiel mit zwei Team-Ausschnitten

**Sobald beide Teams eines Spiels feststehen**, wird dessen **vollständiger Spielblock B03 → B04 → B05 → B07** zur Generierung vorgemerkt und in einem Modellaufruf erzeugt. Der Block enthält die tatsächliche Spielnummer, Disziplin / Altersklasse, Runde und beide Teams, soweit die entsprechenden Spielangaben aktiviert sind. Die optimierte Reihenfolge in Abschnitt 10.4 beginnt weiterhin mit den Feldaufnahmen, zieht anschließend die gemeinsame Startanweisung vor und ergänzt zwischen Spielblöcken die für die nächsten vollständigen Aufrufe fehlenden Hallen- und Offiziellen-Stücke.

**Freigabe und Reihenfolge:**

- Ein Spiel wird vorbereitet, sobald beide tatsächlichen Teams vollständig bekannt sind. Im Doppel müssen beide Spieler jedes Teams feststehen.
- Die freigegebenen Spiele werden **in der Reihenfolge ihrer Ansetzung im Spielplan** generiert: Das zuerst angesetzte, noch nicht vorbereitete Spiel mit zwei feststehenden Teams kommt zuerst.
- Spiele mit einem noch unbekannten Team warten. Andere bereits freigegebene Spiele können währenddessen in ihrer Ansetzungsreihenfolge vorbereitet werden.
- Werden die Teams eines weiteren Spiels bekannt, wird es an seiner Stelle im aktuellen Spielplan in die noch offene Generierungsreihenfolge einsortiert. Eine geänderte Ansetzungsreihenfolge wird bei den noch offenen Aufträgen berücksichtigt.
- Die Vormerkung erfolgt beim Bekanntwerden beider Teams. Die vereinbarte erste Feldstufe und der einzelne Generierungsplatz bleiben erhalten; bereits passende Aufnahmen werden wiederverwendet.
- Die Spielplanreihenfolge ordnet die regulär vorgemerkten **Spielblöcke untereinander**. Dazwischen werden die benötigten gemeinsamen Kontextquellen vorbereitet, damit ein naher Aufruf vollständig nutzbar wird. Es gibt keine Sperre „erst sämtliche Spielblöcke, danach Hallen und Offizielle“.

Die Feldansagen B01 und die Offiziellen B08 gehören nicht zu dieser Aufnahme. Derselbe Spielblock kann dadurch bei D01 und D02 sowie bei einem Feldwechsel wiederverwendet werden.

Aus der vollständigen Aufnahme werden zusätzlich diese zwei Bausteine gewonnen:

| Aufnahme je Spiel | Inhalt | Herkunft |
| --- | --- | --- |
| Vollständiger Spielblock | B03 → B04 → B05 → B07, einschließlich des gesprochenen „gegen“ | Direkt erzeugte Aufnahme; bleibt vollständig für die Wiedergabe erhalten |
| B06-Team1 | Nur der vollständige Teamtext an erster Position, ohne „gegen“ | Ausschnitt aus demselben Spielblock |
| B06-Team2 | Nur der vollständige Teamtext an zweiter Position, ebenfalls ohne „gegen“ | Ausschnitt aus demselben Spielblock |

Die Team-Ausschnitte beziehen sich auf die erste beziehungsweise zweite Seite des tatsächlichen Spiels. Im Einzel enthält ein Ausschnitt den vollständigen Spielernamen, im Doppel beide vollständigen Namen mit „und“ in ihrer tatsächlichen Reihenfolge. Namen werden nicht in Vor- und Nachnamen oder einzelne Wörter zerlegt.

Für das bisherige Beispiel ergeben sich die Team-Ausschnitte:

```text
B06-Team1: Nina Keo Boun Khoune
B06-Team2: LeandraGalowicz
```

Das Wort „gegen“ bleibt in der vollständigen Aufnahme zwischen den Teams hörbar. Es ist in **keinem** der beiden einzeln gespeicherten Team-Ausschnitte enthalten. Die Schnittstellen werden je Quellaufnahme so ermittelt, dass beide Teams vollständig erhalten bleiben und keine Wörter der benachbarten Ansageteile mit übernommen werden.

**Erstellung je Spiel:**

1. Den vollständigen Spielblock mit den beiden tatsächlichen Teams einmal generieren und speichern.
2. Team 1 aus dieser Aufnahme ausschneiden und dem Spiel als B06-Team1 zuordnen.
3. Team 2 ohne das davor gesprochene „gegen“ ausschneiden und dem Spiel als B06-Team2 zuordnen.
4. Den vollständigen Spielblock und beide Team-Ausschnitte aus dem Cache verwenden. Ausschneiden und Speichern lösen keine zusätzliche Sprachgenerierung aus.

Für die regulären Spiel- und Vorbereitungsaufrufe wird der zusammenhängend generierte Spielblock abgespielt. Die Verwendung der zusätzlichen Team-Ausschnitte in weiteren Durchsagen beschreibt der Planungsentwurf in Abschnitt 7.3.

Bei S Spielen mit unterschiedlichen aktuellen Spielblocktexten entstehen **S Generierungen und 3 × S Wiedergabestücke**: S vollständige Spielblöcke und 2 × S Team-Ausschnitte. Es gibt dafür keine zusätzliche Generierungsstufe je Team. Bereits passende vollständige Aufnahmen werden wiederverwendet; fehlende Team-Ausschnitte werden daraus gewonnen.

Ändert sich der gesprochene Inhalt eines Spiels, etwa durch neue Gegner, wird nur dessen benötigte neue Spielblockfassung samt Team-Ausschnitten vorbereitet. Eine Wiederholung des unveränderten Aufrufs oder eine andere Feldzuweisung benötigt keine neue Generierung. Die B01-Feldaufnahmen bleiben unabhängig davon nutzbar.

### 7.3 Planungsentwurf: Weitere Ansagen aus vollständigen Kontextaufnahmen

Dieser Entwurf überträgt das Vorgehen der Feld- und Spielblöcke auf die übrigen Durchsagen. Auch kurze wiederkehrende Texte werden **im Zusammenhang einer vollständigen, sinnvoll gesprochenen Beispiel-Durchsage erzeugt und anschließend ausgeschnitten**. Die Beispielnamen werden nur im Quellaudio gesprochen; im verwendeten Ausschnitt stehen die jeweils vorgesehenen Inhalte.

Wo ein Abschnitt später zusammenbleiben kann, speichern wir ihn als längeres Stück. Insbesondere bleiben ein Team mit beiden Namen, Rolle und Name sowie vollständige Hallen-/Meldeformulierungen zusammen. Die bereits vereinbarte Gewinnung beider Teams ohne „gegen“ bleibt erhalten. Ein vorhandener vollständiger Spielblock wird für D01 und D02 weiterhin unverändert am Stück wiedergegeben.

#### A. Vorbereitung: Feld und Halle gemeinsam gewinnen

Für jede tatsächlich benötigte Kombination aus Halle und Feld entsteht einmal eine vollständige D02-Referenz:

```text
In Vorbereitung {Hallenzusatz}
→ Für Spielfeld {Feld}!
→ festgelegter Beispiel-Spielblock aus Abschnitt 7.1
→ Treffpunkttext der Halle in Mehrzahl
```

Bei ausgeschaltetem Treffpunkt endet die Referenz wie die heutige D02-Vorlage mit `In Vorbereitung {Hallenzusatz}`. Für den Spielblock der Referenz werden die festgelegten Beispielnamen und -angaben verwendet. Es wird keine neue Referenz für jedes tatsächliche Spiel oder jede spätere Paarung erzeugt.

Aus der Quelle gewinnen wir:

- **Vorbereitungsstart mit Feld:** `In Vorbereitung {Hallenzusatz} → Für Spielfeld {Feld}!` bleibt ein gemeinsames langes Stück für D02.
- **Vorbereitungsstart ohne Feld:** B09 allein, für D02 ohne zugewiesenes Spielfeld; je tatsächlich unterschiedlicher Hallenfassung einmal.
- **Vorbereitungsabschluss:** B10 in Mehrzahl oder, bei deaktiviertem Treffpunkt, die abschließende B09-Fassung.
- **Hallenzusatz allein:** sofern er für den Team-Zweitaufruf D05 benötigt wird, ohne ein zusätzliches „In Vorbereitung“ zu übernehmen.

Für den Anfang und den Schluss identischer B09-Texte dürfen getrennte Ausschnitte erhalten bleiben, wenn ihre Betonung unterschiedlich benötigt wird. B02 wird bei D02 zusammen mit B09 wiedergegeben; eine zusätzliche einzeln generierte B02-Aufnahme ist dafür nicht nötig.

Fehlende Hallenformen werden aus ergänzenden **vollständigen** Beispielen gewonnen:

| Benötigte Form | Geeignete Kontextaufnahme | Gewonnene Ausschnitte |
| --- | --- | --- |
| Halle ohne zugeordnetes Feld | D02 ohne Feld, mit dem festen Beispiel-Spielblock | Vollständiger B09-Anfang und der passende Abschluss |
| Einzahl-/Mehrzahlformen von Hallenzusatz und Treffpunkt | D05 mit einem festen Beispiel-Einzelteam beziehungsweise Beispiel-Doppelteam | Hallenzusatz, Treffpunkttext und einmal das gemeinsame Präfix `Zweiter Aufruf In Vorbereitung für:` |
| Bedienaufforderung mit oder ohne Treffpunkt | Vollständiger D11-Referenzaufruf mit festen Beispielnamen und der jeweiligen Personenform | `bitte als Tabletbedienung` samt vollständigem Meldezusatz als ein längerer Ausschnitt |
| Abschluss ohne Treffpunkt für D09/D10 | Vollständiger D09- oder D10-Beispielaufruf | Die abschließende Formulierung `In Vorbereitung!` |

Zuerst werden bereits erzeugte Referenzen auf geeignete Ausschnitte geprüft. Nur fehlende, tatsächlich benötigte Text-/Betonungsformen führen zu ergänzenden Quellen. Gleiche Hallentexte werden nach Möglichkeit geteilt. Die Beispiel-Teamnamen bleiben fest; dies ist keine Generierung je tatsächlichem Team.

Die in Abschnitt 8 beschriebenen Wortlautprobleme von D11 bleiben als eigene Bearbeitungspunkte sichtbar. Das Ausschneiden soll die vorhandene Formulierung nicht unbemerkt umschreiben oder den Fehler durch das Abschneiden von Wörtern kaschieren.

#### B. Offizielle: Eine Quelle pro Rollen-/Namenskombination

Für jede tatsächlich zugeordnete, unterschiedliche Kombination aus Rolle und vollständigem Namen beziehungsweise Bedien-Team wird einmal ein vollständiger normaler Offiziellen-Zweitaufruf erzeugt. Beispielsweise:

```text
Auf Spielfeld acht! Zweiter Aufruf für:Schiedsrichter:{Name}
```

Das Referenzfeld bleibt fest. Bei den späteren echten Durchsagen kommt das jeweilige B01-Anfang aus dem Feldcache zum Einsatz. Für ein anderes Feld oder ein anderes Spiel mit derselben Rollen-/Namenskombination entsteht keine neue Offiziellen-Quelle.

Aus jeder solchen Quelle gewinnen wir:

1. **Langen normalen Zweitaufruf:** `Zweiter Aufruf für:{Rolle}:{Name/n}` bleibt zusammen für D06–D08.
2. **Rolle mit Name:** `{Rolle}:{Name/n}` bleibt zusammen für B08 bei D01/D02 sowie die ersten Abschnitte von D09–D11.
3. **Name beziehungsweise Bedien-Team allein:** für die wiederholte persönliche Ansprache bei D09–D11, falls dafür noch keine passende vollständige Namens-/Teamaufnahme vorhanden ist.

Aus einer der Quellen wird zusätzlich einmal das gemeinsame normale Zweitaufruf-Präfix für D04 gewonnen. Gibt es keine passende Offiziellen-Quelle, dient ein vollständiger D04-Beispielaufruf als Quelle dieses Präfixes.

Einzelne Rollenwörter, Vor-/Nachnamen und das „und“ eines Bedien-Teams werden nicht separat synthetisiert. Für eine neue Rollen-/Namenskombination wird nur die entsprechende fehlende Quelle ergänzt; andere unveränderte Zuordnungen bleiben im Cache.

#### C. Feste Anweisungen und Präfixe

| Wiederverwendeter Ausschnitt | Vollständiger Kontext für seine Gewinnung | Zusätzliche Generierung |
| --- | --- | --- |
| B12 `Bitte mit dem Spielen beginnen!` | `Auf Spielfeld acht! Bitte mit dem Spielen beginnen!` | Eine vollständige D03-Referenz; nur die Startanweisung ausschneiden |
| `Zweiter Aufruf für:` | Normaler Offiziellen-Zweitaufruf aus B oder vollständige D04-Referenz mit Beispielteam und abschließender Feldansage | Keine, wenn eine ohnehin nötige Quelle passt; sonst eine vollständige D04-Referenz |
| `Zweiter Aufruf In Vorbereitung für:` | Eine der vollständigen Vorbereitungs-Zweitaufruf-Referenzen aus A | In den ergänzenden Hallenreferenzen enthalten |
| `Das Spiel geht kampflos an` | Vollständige D12-Referenz mit Spielangaben, beiden Beispielteams und einem Beispiel-Siegerteam | Eine vollständige Referenz; die zusammenhängende Formulierung vor dem Siegerteam ausschneiden |
| Sprachtest | `Dies ist ein Test der Sprachausgabe.` | Eine vollständige Testaufnahme; kein Schnitt nötig |

Damit gibt es im Grundentwurf **fünf gemeinsame feste Wiedergabestücke**. Sie benötigen drei eigene Quellen für D03, die Kampflos-Formulierung und den Sprachtest. Das normale Zweitaufruf-Präfix kann eine vierte eigene Quelle benötigen. Das Vorbereitungs-Präfix stammt aus den Hallenreferenzen. Eine geeignete vorhandene Quelle wird stets zuerst genutzt.

Die Präfixe bleiben in ihren Quellen bis zum tatsächlichen Team beziehungsweise zur Rolle mit Namen verbunden. Wir generieren kein alleinstehendes „Zweiter Aufruf für:“ als vermeintlich vollständigen Satz.

**Hörkorrektur vom 16.10.2026:** Im festen Hörsatz wird nur „In Vorbereitung für“ innerhalb des gemeinsamen Präfixes auf 88 % des bisherigen Tempos gebracht; „Zweiter Aufruf“ bleibt gleich schnell. D05 verwendet Zielabstände von 140 ms vor dem ersten Team, 120 ms vor dem Hallenzusatz, 320 ms vor der Teamwiederholung und gegebenenfalls 160 ms vor dem Treffpunkt. Vorhandene Randstille zählt dazu. D08 erhält innerhalb des langen Klapptafel-Zweitaufrufs nach „Klapptafelbedienung“ zusätzliche 180 ms. Diese quellengebundenen Audiokorrekturen benötigen keine neue Synthese. Für „Das Spiel geht kampflos an“ wird die bisherige gemeinsame D12-Quelle einmalig ersetzt; Anzahl der geplanten Stücke und Generierungen bleibt gleich. Diese Tempo-/Pausenbearbeitung und der D12-Wortlaut sind jetzt auch in die produktive deutsche Kontextstrategie übernommen. Für neue Aufnahmen ermittelt der Server die Grenzen individuell; die festen Hörtest-Frames werden nicht übernommen.

#### D. Kampflose Entscheidungen: Spielblock auch hier zusammenhalten

Der erste Hörsatz teilte den vorhandenen Spielblock für D12 in Spielkopf und vollständige Begegnung. Die zusätzliche Montagepause trennte ein leises Quellsignal vor „Nina“ vom vorherigen Satzteil ab. Der optimierte Hörversuch behält deshalb auch hier den **vollständigen vorhandenen Spielblock** zusammen. Ein gesonderter Spielkopf und ein Begegnungs-Ausschnitt sind für diesen Aufbau nicht erforderlich.

Der überarbeitete Planungsentwurf lautet:

```text
Vollständiger Spielblock B03 → B04 → B05 → B07
→ Das Spiel geht kampflos an
→ vorhandener Ausschnitt des tatsächlichen Siegerteams, ohne „gegen“
```

Für eine kampflose Entscheidung entsteht so zunächst kein neuer spielbezogener Syntheseauftrag. Die gemeinsame Kampflos-Klausel und der schon vorhandene Siegerteam-Ausschnitt ergänzen den Spielblock. Die beiden einzelnen Team-Ausschnitte bleiben weiterhin ohne „gegen“. Beide möglichen Siegerfassungen werden nicht vorsorglich als neue vollständige Ansagen generiert. Die feste Störstelle des Beispiels wird ausschließlich in einer Wiedergabekopie und an ihre geprüfte Quelle gebunden bereinigt; daraus folgt keine allgemeine Zeit- oder Lautstärkeregel für andere Aufnahmen.

**Hörprüfpunkt:** Die heutige D12-Einleitung verwendet Kommata. Nach Team 2 endet der Begegnungssatz; „Das Spiel geht kampflos an“ eröffnet den Ergebnissatz. Der deutsche Browsertext verwendet denselben neuen Wortlaut. Die ursprüngliche Betonung der übernommenen Ausschnitte bleibt hörbar; sie lässt sich durch nachträgliche Pausen nicht exakt an eine andere Satzmelodie anpassen. Falls diese Montage den Hörtest nicht besteht, ist eine vollständige D12-Generierung für die tatsächlich eingetretene Entscheidung die gezielte Alternative. Auch dabei werden keine hypothetischen Sieger durchgeneriert.

#### E. Geplanter Aufbau sämtlicher Durchsagen

Die folgende Tabelle ist der neue lokale Planungsentwurf. Die Textreihenfolge und alle gesprochenen Inhalte aus Abschnitt 4 bleiben erhalten; dort beschriebene abschaltbare oder leere Bestandteile entfallen weiterhin.

| Durchsage | Vorgeschlagene Wiedergabestücke | Zusätzliche Generierung beim Auslösen |
| --- | --- | --- |
| D01 | B01-Anfang → vollständiger Spielblock → vorhandene Rollen-/Namensstücke B08 in ihrer bisherigen Reihenfolge → B01-Ende | Keine bei vorbereitetem Bestand |
| D02 mit Feld | Langer Vorbereitungsstart B09 + B02 → vollständiger Spielblock → Rollen-/Namensstücke → Treffpunkt in Mehrzahl oder B09-Abschluss | Keine bei vorbereitetem Bestand |
| D02 ohne Feld | B09-Anfang der Halle → derselbe Spielblock → Rollen-/Namensstücke → derselbe passende Abschluss | Keine bei vorbereitetem Bestand |
| D03 | B01-Anfang → vollständige Startanweisung B12 | Keine bei vorbereitetem Bestand |
| D04 | Normales Zweitaufruf-Präfix → Team-Ausschnitt der aufgerufenen Seite → B01-Ende des Feldes | Keine bei vorbereitetem Bestand |
| D05 | Vorbereitungs-Zweitaufruf-Präfix → Team-Ausschnitt → Hallenzusatz in passender Personenform → derselbe Team-Ausschnitt nochmals → Treffpunkt in passender Personenform | Keine bei vorbereitetem Bestand; ohne Treffpunkt bleibt die zweite Teamnennung allein |
| D06/D07/D08 | B01-Anfang → langer normaler Zweitaufruf mit Rolle und vollständigem Namen/Bedien-Team | Keine bei vorbereiteter Zuordnung |
| D09/D10 | Vorbereitungs-Zweitaufruf-Präfix → Rolle mit Name → Name allein → Treffpunkt in Einzahl oder `In Vorbereitung!` | Keine bei vorbereiteter Zuordnung und Hallenform |
| D11 | Vorbereitungs-Zweitaufruf-Präfix → Rolle mit Bedien-Team → Bedien-Team allein → längere Bedienaufforderung mit dem passenden Meldezusatz | Keine bei vorbereiteter Zuordnung und Hallenform; heutiger Wortlautfehler separat zu klären |
| D12 | Vollständiger vorhandener Spielblock → `Das Spiel geht kampflos an` → Siegerteam | Keine zusätzliche Spielblock- oder Teamgenerierung; vollständige tatsächliche D12 nur als Alternative bei unzureichendem Hörtest |
| D13 | Vollständiger eingegebener Text in einer Aufnahme | Eine Generierung je neuem, tatsächlich verwendetem Text, falls nicht vorhanden |
| D14 | Vollständiger Sprachtest | Keine, wenn die einmalige Testaufnahme bereitsteht |
| D15 | Bestehende Evakuierungs-MP3 | Keine Synthese |

Die bei D05, D09–D12 vorhandenen Namenswiederholungen bleiben gesprochen erhalten. Wiederholtes Abspielen desselben Ausschnitts benötigt keine erneute Generierung.

#### F. Wiederverwendung, Bereitstellung und Klangprüfung

- Alle Quellen und Ausschnitte gelten für die ausgewählte Stimme und Synthesekonfiguration. Gleicher Text allein reicht nicht aus, um bewusst verschiedene Betonungsformen wie B01-Anfang und B01-Ende zusammenzufassen.
- Schnitte werden je Quelle ermittelt und mit ihr verknüpft. Vollständige Namen und leise Wortenden bleiben erhalten. Die Werte des Feld-8-Beispiels werden nicht auf andere Aufnahmen übertragen.
- Geeignete vorhandene Team-/Namensaufnahmen werden auch für weitere Ansagen genutzt. Es wird kein Vorrat aller denkbaren Team-, Rollen-, Hallen- und Feldkombinationen generiert.
- Wird eine neue Zuordnung oder Hallenfassung benötigt, kommen nur deren fehlende Quellen hinzu. Ein unveränderter Text oder ein Feldwechsel löst keine pauschale Neuerzeugung aus.
- Die Feldaufnahmen bleiben die erste normale Vorbereitungsstufe. Anschließend folgen die gemeinsame Startanweisung und die vollständige Versorgung der nächsten Aufrufe: Spielblöcke untereinander in Spielplanreihenfolge, dazwischen deren fehlende Hallen-/Offiziellen-Quellen. Die konkrete Priorität beschreibt Abschnitt 10.4.
- Für den laufenden Betrieb schlägt der Entwurf vor: Ein echter Aufruf mit fehlenden Teilen erhält vor noch nicht gestarteter ferner Vorarbeit Vorrang. Bereits laufende Generierungen werden fertiggestellt; BTS behält einen offenen Auftrag zur Zeit und priorisiert den nächsten Auftrag selbst.
- Freie Ansagen werden als vollständiger Text vorbereitet, sobald der Entwurf stabil beziehungsweise abgesendet ist. Noch nicht gestartete, überholte Entwurfsaufträge entfallen. Die fertige Aufnahme spielt erst beim tatsächlichen Auslösen.
- Browser-TTS erhält weiterhin die vollständigen Textabschnitte. Die hier beschriebenen Kontextaufnahmen und Schnitte betreffen die lokale Strategie.

Die automatisierten Prüfungen decken den Aufbau mit Einzel und Doppel, optionalen Spielangaben, Rollenwechseln und beiden Siegern ab; der reale Ablauf wurde mit dem Beispielspiel geprüft. Weitere Klangproben mit langen und kurzen Namen sowie beiden Personenformen bleiben sinnvoll. Die Kontextaufnahme ist ein Ansatz für bessere Sprachmelodie; die akustische Gleichwertigkeit zur am Stück gesprochenen Fassung ist für die neuen Kombinationen noch nicht bestätigt.

### 7.4 Noch zu prüfende Details

Die übrigen Punkte können wir direkt in dieser Datei festlegen:

| Thema | Zu entscheiden | Vereinbarung |
| --- | --- | --- |
| Feldansage | Wie entstehen die Aufnahmen für Anfang und Schluss? | B01-Anfang und B01-Ende je Feld aus derselben vollständigen Referenzaufnahme; erste Vorbereitungsstufe für alle Felder (Abschnitt 7.1) |
| Referenzaufruf | Welcher Mittelteil wird für die erstmalige Erstellung der Feldaufnahmen gesprochen? | Festgelegter Beispiel-Spielblock aus Abschnitt 7.1: Spiel 189, Mädcheneinzel U19, Achtelfinale, Nina Keo Boun Khoune gegen LeandraGalowicz; wortgetreu mit ausgeschriebenen Zahlen und unverändert für alle Felder |
| Einsatz weiterer Feldansagen | Welche B01-Ausschnitte verwenden andere Durchsagen? Wie wird B02 erstellt? | D03 verwendet vereinbart B01-Anfang. Entwurf: D04 nutzt B01-Ende, D06–D08 B01-Anfang; D02 erhält B09 + B02 zusammen aus einer vollständigen Vorbereitungsreferenz. |
| Spielblock | Zusammensetzung und Aufnahmegrenzen | Festgelegt: B03 → B04 → B05 → B07 als eine vollständige Aufnahme je Spiel mit den tatsächlichen Teams (Abschnitt 7.2) |
| Namen und Paarungen | Wie entstehen die Teamaufnahmen? | Aus jedem Spielblock zwei vollständige Team-Ausschnitte gewinnen; beide ohne „gegen“, keine zusätzliche Generierung je Team (Abschnitt 7.2) |
| Offizielle | Welche Rollen-/Namensstücke lassen sich natürlich zwischen normalen Aufrufen und Zweitaufrufen wiederverwenden? | Entwurf: vollständige normale Zweitaufruf-Quelle je Rollen-/Namenskombination; daraus langer Zweitaufruf, Rolle mit Name und gegebenenfalls Name allein. Übergänge hörprüfen. |
| Vorbereitung | Welche Hallen- und Treffpunkttexte bilden jeweils einen vollständigen Satz? | Entwurf: langer Vorbereitungsstart je Feld/Hallenfassung, ergänzende vollständige Referenzen nur für fehlende Hallenformen. |
| Zweitaufrufe | Wie viel Zusammenhang brauchen Präfix, Rolle, Name und Zielort? | Entwurf: Präfixe aus vollständigen Referenzen, vorhandene Team-Ausschnitte und längere Rollen-/Namensstücke verwenden. |
| Kampflos | Welche Aufnahmen können mit D01/D02 geteilt werden, ohne die andere Satzmelodie zu verlieren? | Optimierter Entwurf: vollständigen Spielblock erhalten, gemeinsame Klausel und vorhandenes Siegerteam ergänzen. Hörprobe entscheidet über Verwendbarkeit. |
| Pausen und Betonung | Welche Pausen gehören in die Aufnahme, welche setzen wir beim Abspielen? | Hörversuch: vorhandene leise Ränder auf die Zielpause anrechnen, kurze Fades an aktiven Schnittstellen. Innere Melodie bewahren. Modell-Hervorhebungen werden gesondert erprobt; sie sind keine garantierte Betonung. |
| Browser-TTS | Welche bestehende Abschnittsaufteilung behalten oder ändern wir dafür? | Entwurf: bisherige vollständige Browserabschnitte beibehalten. |
| Vorab-Cache | Welche Varianten müssen vorbereitet werden, und welche erst nach einer tatsächlichen Änderung? | Zuerst Feldaufnahmen; die Spielblöcke bleiben untereinander in Ansetzungsreihenfolge. Optimierter Entwurf: B12 früh vorziehen, dann nächste Aufrufe einschließlich ihrer Hallen-/Offiziellen-Teile vollständig vorbereiten; Zweitaufrufe und gemeinsame Kampflos-Klausel vor ferner Vorarbeit. Details und Vorrang tatsächlicher Anforderungen in Abschnitt 10.4. |

Für eine vereinbarte neue Fassung können wir je Durchsage anschließend festhalten:

```text
Kennung: D…
Gewünschter gesprochener Text:
Gewünschte lokale Aufnahmegrenzen:
Wiederverwendete Aufnahmen:
Neu zu erzeugen bei Änderung von:
Wiedergabepausen:
Browser-Aufbau:
Hörbewertung / weitere Notizen:
```

## 8. Auffälligkeiten im heutigen Wortlaut

Diese Punkte sind dokumentiert, damit sie bei der gemeinsamen Bearbeitung nicht verloren gehen:

- D11: Der Meldezusatz kann Wörter ohne Abstand aneinanderhängen und Einzahl-/Mehrzahlformulierungen ungünstig kombinieren.
- D11: Die zweite Ansprache nennt auch bei manuellen Klapptafeln weiterhin „Tabletbedienung“.
- B05: Beim Zusammensetzen von Platzierungsrunden fehlen teilweise Leerzeichen.
- Mehrere Präfixe und Rollen werden aktuell direkt hinter einem Doppelpunkt ohne Leerzeichen angefügt. Diese Stellen sind in den Vorlagen oben sichtbar.

## 9. Bezug zum Programmcode und zu den Hörproben

- [Textaufbau sämtlicher Spielaufrufe](../static/js/announcement_text.js)
- [Deutsche Sprachvorlagen](../static/js/ci18n_de.js)
- [Vorbereitung der lokalen Ansageteile](../bts/speech/text.js)
- [Umwandlung der Zahlen für lokale Synthese](../bts/speech/numbers.js)
- [Wiedergabe und Evakuierungsaufnahme](../static/js/announcements.js)
- [Bedienelemente für freie Ansagen und Sprachtest](../static/js/ctournament.js)
- [Anbindung der lokalen Sprachausgabe](local-tts-integration.md)
- [Hörvergleich und geprüfte Kontext-Ausschnitte](tts-listening-lab.md)

Die Kennungen dieses Dokuments decken alle 14 spielbezogenen Auslöser ab: D04 und D05 haben jeweils eigene Auslöser für Team 1 und Team 2. Die technischen Zuordnungen lauten:

| Kennung | Textfunktion |
| --- | --- |
| D01 | `announceNewMatch` |
| D02 | `announcePreparationMatch` |
| D03 | `announceBeginnToPlay` |
| D04 | `announceSecondCallTeamOne`, `announceSecondCallTeamTwo` |
| D05 | `announceSecondPreparationCallTeamOne`, `announceSecondPreparationCallTeamTwo` |
| D06 | `announceSecondCallUmpire` |
| D07 | `announceSecondCallServiceJudge` |
| D08 | `announceSecondCallTabletoperator` |
| D09 | `announceSecondPreparationCallUmpire` |
| D10 | `announceSecondPreparationCallServiceJudge` |
| D11 | `announceSecondPreparationCallTabletoperator` |
| D12 | `announceNoMatchWin` |

## 10. Übersicht am Dateiende: Satzstücke, Anzahl und Generierungsreihenfolge

Diese Übersicht wird bei jeder weiteren Festlegung zur Stückelung und Reihenfolge mit aktualisiert. Sie beschreibt den geplanten Bestand für die ausgewählte lokale Stimme. Bereits passende Aufnahmen werden wiederverwendet. Die Angaben zum Generierungsaufwand beziehen sich auf einen vollständig leeren Cache.

**F** ist die Anzahl aller im Turnier angelegten Felder. **S** ist die Anzahl der vorzubereitenden Spiele, deren beide Teams bereits feststehen, in ihrer jeweils aktuellen Spielblockfassung; die folgenden Planungsmengen setzen unterschiedliche Spielblocktexte voraus. Werden weitere Teams bekannt, kommen die entsprechenden Spiele hinzu. Ein wiederverwendetes Satzstück zählt einmal zum Bestand, unabhängig davon, wie oft es später abgespielt wird. Bei B01 zählen Anfang und Ende wegen ihrer unterschiedlichen Betonung als zwei Aufnahmen je Feld. Die vollständigen Feld-Referenzaufnahmen werden zusätzlich aufbewahrt, zählen hier aber nicht als weitere Wiedergabestücke. Die vollständigen Spielblöcke werden dagegen selbst abgespielt und deshalb zusätzlich zu ihren Team-Ausschnitten gezählt.

### 10.1 Festgelegte Feld- und Spielaufnahmen

Diese Tabelle gruppiert die Quellen und ihre Ausbeute. Die vollständige zeitliche Reihenfolge steht in 10.4; insbesondere werden die Spielblöcke mit benötigten Zusatzquellen verschachtelt.

| Herkunft | Benötigtes Satzstück | Gesprochener Text | Anzahl der Wiedergabestücke |
| --- | --- | --- | --- |
| Je Feld gemeinsam erzeugt | B01-Anfang | `Auf Spielfeld {Feld}!` vom Anfang des Referenzaufrufs | F |
| Aus derselben Feldquelle | B01-Ende | `Auf Spielfeld {Feld}!` vom Ende des Referenzaufrufs | F |
| **Summe der Feldstufe** | | | **2 × F** |
| Je Spiel einmal erzeugt | Vollständiger Spielblock | B03 → B04 → B05 → B07 mit den tatsächlichen Teams | S |
| Aus demselben Spielblock | B06-Team1 | Nur der vollständige Teamtext an erster Position, ohne „gegen“ | S |
| Aus demselben Spielblock | B06-Team2 | Nur der vollständige Teamtext an zweiter Position, ebenfalls ohne „gegen“ | S |
| **Summe der Spielblockstufe** | | | **3 × S** |
| **Summe beider Stufen** | | | **2 × F + 3 × S** |

**Aufwand der Feldstufe: F vollständige Generierungen für 2 × F Wiedergabestücke.** Anfang und Ende werden aus derselben Aufnahme gewonnen und lösen keine getrennten Generierungsaufträge aus. Die Verwendung von B01-Anfang bei D03 benötigt ebenfalls keine weitere Feldaufnahme.

**Aufwand der Spielblockstufe: S vollständige Generierungen für 3 × S Wiedergabestücke.** Die Spiele werden freigegeben, sobald beide Teams feststehen, und in der angesetzten Spielplanreihenfolge generiert. Beide Team-Ausschnitte entstehen aus dem jeweiligen vollständigen Spielblock und benötigen keine zusätzlichen Modellaufrufe. Die weitere Verwendung desselben Spielblocks bei D01 und D02 wird nicht doppelt gezählt.

**Zusammen: F + S vollständige Generierungen für 2 × F + 3 × S Wiedergabestücke**, zusätzlich zu den weiteren im Entwurf geplanten Bereichen. Dies ist eine Bestandszählung, keine Vorgabe für geschlossene Generierungsblöcke. Bei bereits passenden oder identischen Texten kann Wiederverwendung den tatsächlichen Aufwand und Bestand verringern.

Für jede Feld-Referenzgenerierung wird der festgelegte Beispiel-Spielblock aus Abschnitt 7.1 zwischen die beiden Spielfeldansagen gesetzt. Er wird nicht zusätzlich als eigener Text angefordert. Ob wir seinen Mittelteil ebenfalls ausschneiden und als Baustein nutzen, ist noch offen; deshalb wird er hier nicht als weiterer fertiger Baustein mitgezählt. Die Spielblockstufe verwendet die tatsächlichen Spielangaben und feststehenden Teams des jeweiligen Spiels.

### 10.2 Zusätzliche Satzstücke des Planungsentwurfs

Die folgenden Stücke ergänzen den Bestand aus 10.1. Sie werden aus den vollständigen Kontextaufnahmen in Abschnitt 7.3 gewonnen. Ein Ausschnitt verursacht keinen eigenen Modellaufruf. Leere beziehungsweise nicht benötigte Formen werden ausgelassen; gleiche geeignete Text-/Betonungsformen werden einmal gezählt.

| Satzstück | Anzahl der zusätzlichen Wiedergabestücke | Vollständige Quelle und Wiederverwendung |
| --- | --- | --- |
| Langer Vorbereitungsstart B09 + B02 | 1 je benötigter unterschiedlicher Hallen-/Feldfassung | D02-Referenz mit festem Beispiel-Spielblock; nicht je tatsächlichem Spiel |
| B09-Anfang ohne Feld | 1 je benötigter Hallenfassung | Aus vorhandener D02-Referenz, sonst D02-Beispiel ohne Feld |
| B09-Abschluss bei deaktiviertem Treffpunkt | 1 je benötigter Abschlussfassung | Ende der passenden D02-Referenz; Anfang und Ende nur bei geeigneter gleicher Betonung teilen |
| Hallenzusatz für D05 | 1 je benötigter Einzahl-/Mehrzahlfassung | Aus vorhandener Referenz, sonst vollständiges D05-Beispiel |
| Treffpunkt B10 | 1 je benötigter Einzahl-/Mehrzahlfassung | Aus vorhandenen D02-/D05-Referenzen; auch für D09/D10 nutzen |
| Längere Bedienaufforderung für D11 | 1 je benötigter Hallen-/Personenfassung einschließlich Variante ohne Treffpunkt | Vollständiges D11-Beispiel; `bitte als Tabletbedienung` und Meldezusatz bleiben zusammen |
| Abschluss `In Vorbereitung!` für D09/D10 | 1 gemeinsam, falls benötigt | Vollständiges Vorbereitungs-Zweitaufruf-Beispiel |
| Langer normaler Offiziellen-Zweitaufruf | R, wobei R die Anzahl unterschiedlicher tatsächlicher Rollen-/Namenszuordnungen ist | Je Zuordnung eine vollständige D06-/D07-/D08-Referenz mit festem Referenzfeld |
| Rolle mit vollständigem Namen/Bedien-Team | R | Ausschnitt aus denselben R Quellen; für B08 und D09–D11 |
| Name/Bedien-Team allein | U, höchstens R | Nur soweit noch keine geeignete Namens-/Teamaufnahme vorhanden ist; aus denselben R Quellen, zwischen Rollen wiederverwenden |
| B12 `Bitte mit dem Spielen beginnen!` | 1 gemeinsam | Vollständige D03-Referenz |
| Normales Zweitaufruf-Präfix `Zweiter Aufruf für:` | 1 gemeinsam | Aus einer Offiziellen-Referenz; nur falls keine passt, eine eigene vollständige D04-Referenz |
| Vorbereitungs-Präfix `Zweiter Aufruf In Vorbereitung für:` | 1 gemeinsam | Aus einer vollständigen Vorbereitungs-Zweitaufruf-Referenz, gemeinsam mit Hallenstücken gewinnen |
| `Das Spiel geht kampflos an` | 1 gemeinsam | Vollständige D12-Referenz mit Beispielteams und einem Beispiel-Sieger |
| Sprachtest D14 | 1 gemeinsam | Vollständige Testaufnahme, kein Schnitt |
| Spielkopf und Begegnung als getrennte D12-Stücke | 0 im optimierten Entwurf | Vollständigen Spielblock wiederverwenden; die zwei historischen Testschnitte bleiben nur im bisherigen Hörsatz vorhanden |
| Freie Ansage D13 | 0 im festen Vorrat; 1 je neuem vollständigem Text | Erst bei vorhandenem konkretem Text erzeugen |
| Vollständige tatsächliche D12 als mögliche Alternative | 0 im Grundentwurf | Nur falls der Hörtest eine vollständige Aufnahme erfordert; dann 1 je tatsächlichem unterschiedlichem Ergebnistext |
| Evakuierung D15 | 0 neu zu generieren | Bestehende MP3 |

Die ersten sieben Tabellenzeilen bilden zusammen die **H unterschiedlichen Vorbereitungs-/Hallenstücke**. **Q** zählt die dafür benötigten vollständigen Kontextquellen, nicht die Hallen: Eine vollständige Quelle kann mehrere Stücke liefern. Q umfasst alle benötigten vollständigen D02-/D05-/D09-/D10-/D11-Beispiele einschließlich der Quelle für das gemeinsame Vorbereitungs-Präfix. Es gibt keine solche Quelle je tatsächlichem Team.

Die fünf gemeinsamen Stücke von B12 bis Sprachtest benötigen zusammen **G = 3 zusätzliche vollständige Generierungen**: D03-Referenz, D12-Referenz und Sprachtest. **G = 4**, wenn das normale Zweitaufruf-Präfix zusätzlich eine eigene D04-Referenz benötigt. Die Quelle des Vorbereitungs-Präfixes ist bereits in Q enthalten, die einer geeigneten Offiziellen-Referenz bereits in R. Diese Quellen werden nicht erneut addiert.

### 10.3 Anzahl der Stücke und vollständigen Generierungen

Für den Grundentwurf mit allen beschriebenen Funktionen, einer Stimme, leerem Cache und unterschiedlichen aktuellen Spielblocktexten gilt:

| Bereich | Vollständige Generierungen | Wiedergabestücke |
| --- | --- | --- |
| Alle Felder | F | 2 × F |
| Alle bereiten Spielblöcke samt beiden Teams | S | 3 × S |
| Vorbereitung und Hallenformen | Q | H |
| Offizielle | R | 2 × R + U |
| Fünf gemeinsame feste Stücke | G = 3 oder 4 | 5 |
| **Vorbereiteter Grundbestand** | **F + S + Q + R + G** | **2 × F + 3 × S + H + 2 × R + U + 5** |

Q und H werden aus den tatsächlich benötigten Hallen-/Feldtexten und Personenformen in 10.2 gezählt; R aus den tatsächlichen Rollen-/Namenszuordnungen. U zählt nur zusätzliche noch fehlende reine Namensaufnahmen. Werden Funktionen nicht verwendet, entfallen ihre Stücke und nur dafür benötigten Quellen. Bewusst unterschiedliche Betonungsformen werden weiterhin getrennt gezählt.

**Rechenbeispiel:** Bei 16 Feldern und 100 unterschiedlichen bereiten Spielblöcken entstehen 32 Feldstücke, 100 vollständige Spielblöcke und 200 Team-Ausschnitte, zusammen **332 Wiedergabestücke aus 116 Generierungen**. Mit den fünf gemeinsamen Stücken und den turnierabhängigen Vorbereitungs-/Offiziellen-Aufnahmen ergibt der Entwurf insgesamt **337 + H + 2 × R + U Wiedergabestücke aus 119 + Q + R Generierungen**; bei eigener D04-Präfixquelle sind es **120 + Q + R Generierungen**. Q, H, R und U müssen am tatsächlichen Turnier gezählt werden. Das Beispiel ist keine Zählung eines konkreten Turniers.

Im Betrieb können noch folgende Mengen hinzukommen:

- **W weitere Ausschnitte für D12:** W = 0 im optimierten Entwurf, weil der Spielblock zusammenbleibt. Der frühere getrennte Hörversuch benötigte bis zu zwei zusätzliche Ausschnitte je betroffenem Spiel, ohne zusätzliche Synthese.
- **X neue freie Ansagen:** X vollständige Generierungen und X Wiedergabestücke.
- **Z vollständige tatsächliche D12-Fassungen**, falls nach dem Hörtest erforderlich: Z zusätzliche Generierungen und Z Wiedergabestücke. Im Grundentwurf ist Z = 0; bei Nutzung dieser Alternative werden dafür nicht eigens unbenötigte Montageschnitte angelegt.

Damit erhöht sich der Grundbestand um **W + X + Z Wiedergabestücke** und **X + Z Generierungen**. Bereits passende Quellen und Ausschnitte verringern den noch offenen Aufwand. Aufbewahrte reine Kontextquellen zählen nicht zusätzlich als Wiedergabestücke. Mehrfaches Abspielen eines Teamstücks oder Einsatz in mehreren Durchsagen wird nicht erneut gezählt. Die Anwesenheitskontrolle bleibt ausgeschlossen.

### 10.4 Reihenfolge der Generierung

**Leitlinie:** Zuerst die nächsten Durchsagen vollständig abspielbar machen. Ein früh erzeugter Spielblock hilft erst dann für den ganzen Aufruf, wenn dessen übrige benötigte Teile ebenfalls bereitstehen. Deshalb werden Hallen- und Offiziellen-Quellen zwischen Spielblöcke eingeschoben; es werden nicht erst alle S Spielblöcke abgearbeitet.

**Annahme zum üblichen Ablauf:** Zu Beginn werden Spiele direkt auf freie Felder gerufen. Im laufenden Turnier steht vor dem Feldaufruf häufig der Vorbereitungsaufruf. Die Startaufforderung kann kurz danach nötig werden; Zweitaufrufe betreffen vor allem gerade aufgerufene oder vorbereitete Spiele. Kampflose Entscheidungen sind seltener und zeitlich nicht sicher vorhersehbar. Tatsächliche Turnierzustände und manuelle Anforderungen haben Vorrang vor dieser Annahme.

Als nahe Aufrufe betrachten wir zunächst alle bereits in Vorbereitung befindlichen Spiele sowie je Halle die nächsten bereiten Spiele in Spielplanreihenfolge, zunächst so viele wie dort nutzbare Felder. Ohne Hallenaufteilung gilt diese Orientierung für das Turnier insgesamt. Das deckt die nächste Feld- und Vorbereitungswelle ab, ohne weit entfernte Paarungen vorzuziehen. Ein Spielblock wird weiterhin erst bei zwei vollständig bekannten Teams freigegeben; fehlende Teams blockieren nachfolgende bereite Spiele nicht.

Die Vormerkungen der regulären Spielblöcke behalten dabei turnierweit ihre Ansetzungsreihenfolge. Liegen vor einem nahen Spiel noch frühere bereite Spiele mit fehlendem Spielblock, entstehen deren Blöcke zuerst; ihre erst später benötigten Zusatzformen dürfen warten. Der nahe Bereich steuert die Dringlichkeit der übrigen Quellen und rechtfertigt kein Umsortieren der regulären Spielblöcke. Ausgenommen bleibt der Vorrang eines tatsächlich ausgelösten Aufrufs.

**Normale Vorarbeit bei leerem Cache:**

| Priorität | Nächste Generierung | Nutzen und Reihenfolge innerhalb der Gruppe |
| --- | --- | --- |
| 1 | **B01-Anfang und B01-Ende für alle Felder** | Die vereinbarte erste Stufe bleibt erhalten. Zuerst Felder mit dem frühesten geplanten Einsatz, restliche Felder in Feldreihenfolge. Je vollständiger Referenz beide Ausschnitte sofort bereitstellen; bei Nummernlücken nur angelegte Felder bearbeiten. |
| 2 | **Gemeinsame Startanweisung B12** | Eine vollständige D03-Referenz liefert `Bitte mit dem Spielen beginnen!`. Zusammen mit den Feldstücken ist D03 damit für alle Felder bereit, bevor viele weitere Spielblöcke entstehen. |
| 3 | **Die nächsten regulären Aufrufe vollständig vorbereiten** | Je nahem Spiel den Spielblock samt beiden Team-Ausschnitten erstellen und anschließend die für seine nächste D01- oder D02-Ansage fehlenden Hallen- und Offiziellen-Quellen ergänzen. Erst dann das nächste Spiel bearbeiten. Die Spielblöcke bleiben untereinander in Ansetzungsreihenfolge. |
| 4 | **Zweitaufrufe für die gerade aufgerufenen und nahen Spiele absichern** | Die Teamstücke und normalen Offiziellen-Zweitaufrufe sind überwiegend schon vorhanden. Nur fehlende Präfixe, passende Einzahl-/Mehrzahlformen und Bedienaufforderungen ergänzen; Quellen mit mehreren benötigten Ausschnitten zuerst. |
| 5 | **Gemeinsame Kampflos-Formulierung** | Ein vollständiges D12-Beispiel liefert einmal `Das Spiel geht kampflos an`. Diese gemeinsame Absicherung kommt vor weit entfernten Spielblöcken. Den jeweiligen Spielblock vollständig wiederverwenden. |
| 6 | **Weitere bereite Spiele samt ihren benötigten Zusatzteilen** | Den Vorrat in Spielplanreihenfolge erweitern. Für jedes Spiel wiederum die nächste Ansage vervollständigen, vorhandene Hallen-/Rollenstücke teilen. Bei neuem nahen Bedarf zurück zu Priorität 3 beziehungsweise 4. |
| 7 | **Weitere tatsächlich benötigte Sonderformen und automatischer Sprachtest** | Verbleibende Hallen-/Bedienformen für spätere Einsätze und die Testaufnahme nachrangig vorbereiten. Keine hypothetischen Team-, Rollen- oder Hallenkombinationen erzeugen. Ein ausdrücklich angeforderter Sprachtest wartet nicht auf diese Gruppe. |

**Welche Zusatzteile ein nahes Spiel benötigt:**

- Für den direkten Feldaufruf D01: Spielblock und die tatsächlich zugeordneten Offiziellen in ihrer Ansagereihenfolge. Hallenstücke werden dafür nicht vorgezogen. Die Feldstücke sind bereits vorhanden.
- Für den Vorbereitungsaufruf D02: Spielblock, passender Vorbereitungsstart, tatsächlich zugeordnete Offizielle und passender Abschluss. Eine vollständige D02-Hallenreferenz kann Start und Abschluss zugleich liefern. Ohne festes Feld die Fassung ohne Feld verwenden; keine fehlende Feldzuordnung abwarten.
- Ist ein Spiel bereits in Vorbereitung, ist als Nächstes normalerweise D01 relevant. Einen schon ausgegebenen D02-Aufruf bereiten wir nicht zusätzlich vor, bevor die nächste nötige Ansage vollständig ist. Ein tatsächlich angefordertes Wiederholen erhält sofort Vorrang.
- Fehlende oder ausgeschaltete optionale Angaben werden ausgelassen. Eine spätere tatsächliche Zuordnung ergänzt nur die dann fehlende Quelle; sie hält vorher keine unvollständige Ansage künstlich offen.
- Die Quellen werden nach ihren nutzbaren Ausschnitten bewertet. Liefert eine ohnehin benötigte Offiziellen- oder Hallenquelle zugleich ein fehlendes Zweitaufruf-Präfix, wird sie passend vorgezogen. Eine eigene D04-Präfixquelle ist nur nötig, wenn keine geeignete solche Quelle vorhanden oder für die Vorbereitung vorgesehen ist. Ist eine vorgesehene Quelle noch nicht fertig, wird deren Auftrag vorgezogen, statt denselben Bedarf zusätzlich zu generieren.

**Beispiel für das Verschachteln:** A und B stehen für die ersten beiden bereiten Spiele in ihrer Ansetzungsreihenfolge; die Feldstufe ist fertig. A wird direkt auf ein Feld gerufen, B zunächst in Vorbereitung.

```text
1. D03-Referenz → gemeinsames B12
2. Spielblock A → vollständiger Block + Team 1 + Team 2, beide ohne „gegen“
3. Fehlende tatsächliche Offiziellen-Quellen für A → D01 von A vollständig bereit
4. Spielblock B → vollständiger Block + beide Team-Ausschnitte
5. Fehlende D02-Hallenreferenz und Offiziellen-Quellen für B
   → D02 von B vollständig bereit; D01 nutzt später denselben Spielblock
6. Fehlende Stücke für Zweitaufrufe dieser nahen Spiele ergänzen
7. D12-Referenz → gemeinsame Kampflos-Formulierung
8. Weitere Spielblöcke jeweils mit ihren nötigen Zusatzquellen
```

Jede bereits passende Quelle und jeder passende Ausschnitt überspringt den betreffenden Schritt. Gemeinsam benötigte Teile werden beim ersten Bedarf bereitgestellt und für spätere Spiele wiederverwendet. Die Reihenfolge ändert den Gesamtbestand und die Mengenformeln aus 10.3 nicht.

**Vorrang während des Betriebs:**

1. **Tatsächlich ausgelöste Durchsagen mit fehlendem Audio:** Die fehlenden Quellen und Schnitte vervollständigen den konkreten Aufruf vor jeder noch nicht gestarteten Vorarbeit. Das gilt auch für abgesendete freie Ansagen und tatsächliche kampflose Ergebnisse. Mehrere wartende tatsächliche Durchsagen behalten ihre Auslösereihenfolge; vorbereitende Aufträge drängen sich nicht dazwischen.
2. **Ausdrücklich angeforderte Hörprobe oder Sprachtest:** Fehlendes Audio nach bereits wartenden tatsächlichen Durchsagen, vor normaler Vorarbeit erzeugen. Dadurch lässt sich die Stimme auch vor Abschluss der Feldstufe prüfen.
3. **Die normale Vorarbeit aus der Tabelle:** Nach jedem fertigen Auftrag den nächsten tatsächlichen Bedarf neu prüfen. Ein stabiler freier Textentwurf darf nach den nahen Aufrufen und vor ferner Vorarbeit vorbereitet werden; überholte, noch nicht gestartete Entwürfe entfallen. Allein die Generierung löst keine Wiedergabe aus.

Ein bereits laufender Auftrag wird fertiggestellt. BTS verwaltet die Reihenfolge und hält **höchstens einen offenen Generierungsauftrag** beim Sprachserver. Quellen werden bei mehreren wartenden Durchsagen nur einmal erzeugt. Fehlende Schnitte aus vorhandenem Audio benötigen keinen Modellauftrag und werden direkt bereitgestellt; danach wird der verfügbare Bestand aktualisiert. Neue Paarungen, Ansetzungen oder Zuordnungen ordnen nur noch offene Arbeit neu. Die Spielplanreihenfolge gilt für die regulären Spielblock-Vormerkungen; ein konkreter ausgelöster Aufruf darf die für ihn fehlende Quelle vorziehen.

Diese Reihenfolge ist der optimierte Planungsentwurf. Kontextgenerierung, Schnitt und Cache-Nutzung werden erst nach unserer Abstimmung in die Anwendung übertragen.

## 11. Stimmenwahl im v2-Hörlabor (18. Oktober 2026)

Für die weiteren Versuche mit der **Hallensprecherin verwenden wir einheitlich
`hallensprecherin_vorbereitung.wav`**, auch für Spielaufrufe. Die neue Aufrufreferenz
bleibt als Vergleich erhalten. Gemeinsame Nummern-, Disziplin- und Teamstücke
werden damit nicht nach Durchsageart verdoppelt.

**Der Hallensprecher bleibt unverändert.** Die Auswahl gilt zunächst für das
isolierte Hörlabor; die produktive v1 und der Planungsentwurf oben werden dadurch
nicht umgestellt. Die vorhandenen Frauenproben bleiben zum Vergleich erhalten.

Im ersten aktuellen v2-Spielbeispiel heißt das zweite Team nach der Korrektur
**Leandra Galowicz**, mit Leerzeichen. Der neue Teamkontext lautet
`Leandra Galowicz spielt jetzt gegen Leandra Galowicz!`. Die historischen
Referenztexte und die bereits aufgenommenen Feldanfänge/-enden bleiben erhalten;
deren verworfener Kontext wird wegen dieser Namenskorrektur nicht erneut erzeugt.
Lange gemessene Ruhebereiche im Disziplinbaustein und im korrigierten Teamkontext
werden gezielt gekürzt. Das Sprechtempo und die beiden bereits gut befundenen
Spielbeispiele bleiben unverändert.

Für weitere Frauen-v2-Versuche werden Quellaufnahmen vor dem Schnitt automatisch
auf überlange innere Ruhe geprüft, einschließlich vorhandener Cache-Treffer.
Grenzen: 500 ms innerhalb eines Satzteils, 800 ms an belegten Komma-/Doppelpunkt-
oder Semikolongrenzen, 1.200 ms an belegten Satzgrenzen. Nach einer Ablehnung folgen
höchstens zwei Wiederholungen mit anderem Seed und derselben Stimme. Erst eine
bestandene Aufnahme wird übernommen; nach drei Ablehnungen bleibt der Auftrag
sichtbar unvollständig. Ablehnungen werden gespeichert, damit dieselben Kandidaten
beim nächsten Lauf nicht erneut berechnet werden. Gute Aufnahmen bleiben erhalten.

## 12. B12 im v2-Hörlabor: Startanweisung

Für beide Stimmen ist die folgende Kontextaufnahme als Hörprobe erstellt:

```text
Auf Spielfeld acht! Bitte mit dem Spielen beginnen!
```

Nur **„Bitte mit dem Spielen beginnen!“** wird als B12 ausgeschnitten. Der fertige
D03-Aufruf setzt **den bisherigen B01-Feldanfang → B12** zusammen. Das erste
Feldstück der neuen D03-Aufnahme wird dafür nicht zusätzlich verwendet. Ein B12
pro Stimme reicht für alle Felder; es gibt keine Generierung pro Feld oder Spiel.

Die gemeinsame Hörseite `http://127.0.0.1:8084/spielbeginn/` enthält für beide
Sprecher den zusammengesetzten Aufruf, B12 allein und die vollständige Kontextquelle.
Genau zwei neue Aufnahmen waren nötig; die vorhandenen Feldstücke bleiben bytegleich.
Die Pausenprüfung gilt im ausdrücklich gekennzeichneten neuen Hörplan für beide
Stimmen. Referenzen und Tempo bleiben wie zuvor. Am 18. Oktober 2026 hat der Betreiber
B12 und den zusammengesetzten D03-Aufruf für beide Stimmen klanglich bestätigt
(„passt beides!“). Der produktive Stand wird durch diesen Hörversuch nicht umgestellt.

## 13. Vorbereitung nach Location im v2-Hörlabor

Historischer Hörstand vor der Änderung des Vorbereitungsabschlusses in Abschnitt 15.

**Korrektur: Vollständige Location-Texte werden direkt erzeugt, mit demselben
Wortlaut und denselben Satzzeichen wie bei der Browserstimme.** Zusätzliche
Kontextsätze und Ausschnitte sind für diese Bausteine nicht vorgesehen. Nur die
vereinbarte Zahlenausschreibung bleibt eine lokale Synthesevorbereitung.

`scripts/tts-preparation-context-plan.js` übernimmt die tatsächlichen Locations
und den Schalter für die Treffpunktfunktion aus dem BTS-Export. Die bestehenden
Browser-Textfunktionen liefern den Vorbereitungsanfang und den Mehrzahl-Treffpunkt.
Der Location-Name ist keine Ansagetextvorlage. Zusätzliche Satzzeichen werden nicht
angehängt. Ein leer hinterlegter aktiver Treffpunkt bleibt leer; der Browserstandard
`Treffen am Meetingpoint!` gilt nur ohne angelegte Location.

Jeder unterschiedliche vollständige Location-Text wird je Stimme als eine verwendbare Aufnahme erzeugt
oder aus dem Cache übernommen. Gleiche Texte teilen dieselbe Quelle und dieselbe
Aufnahme, auch für Anfang und Ende. Die fertige D02-Montage setzt diese Aufnahmen
um den bereits bestätigten Spielblock, dessen IDs, Schnitte und Kontexte bleiben
unverändert. Diese erste Stufe enthält noch kein festes Spielfeld und keine
Offiziellen. Einzahlformen für gezielte Zweitaufrufe folgen später.

Am 18. Oktober 2026 ist `Campus Helleweg` mit leeren Location-Ansagetexten und
abgeschalteter Treffpunktfunktion gespeichert. Wie im Browser lautet der
Location-Text deshalb exakt `In Vorbereitung`, ohne zusätzliche Satzzeichen.
Eine direkte Aufnahme je Stimme wird am Anfang und am Ende abgespielt; dazwischen
steht der vorhandene Spielblock 161. Der frühere Kontextversuch ist abgelöst.

`http://127.0.0.1:8084/vorbereitung/` zeigt beide Stimmen, die Location-Einstellungen,
die direkten Aufnahmen und ihre Montage. Die historische Kontextfassung bleibt
unter `/vorbereitung-kontext/` erhalten. Die Seite verwendet den eingelesenen
Stand; geänderte Einstellungen erfordern einen neuen Plan/Lauf. Die Klangabnahme
der direkten Location-Aufnahme ist offen. Der produktive BTS bleibt auf v1.

## 14. Hörversuch: Ausrufezeichen im vollständigen Vorbereitungskontext

Dieser Vergleich dokumentiert noch den bisherigen Abschluss. Abschnitt 15 setzt darauf auf.

Auf Wunsch wird bei beiden Stimmen **im vollständigen Kontextsatz** das erste
Satzzeichen nach `In Vorbereitung` von `:` auf `!` geändert. Das Modell erhält:

```text
In Vorbereitung! Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Muhammad Sytsh Abdulquddus gegen Max Hahn. In Vorbereitung!
```

Aus dieser neuen vollständigen Aufnahme wird nur der Anfang ausgeschnitten.
Die Vergleichsmontage ersetzt ausschließlich den bisherigen Anfangsausschnitt;
Spielblock, fertiger Abschluss und Montagepausen werden unverändert wiederverwendet.
Der Abschluss des Kontextsatzes enthielt bereits ein Ausrufezeichen und bleibt so.

`http://127.0.0.1:8084/vorbereitung-ausrufezeichen/` bietet je Stimme den bisherigen
und den neuen Aufruf, beide Anfangsausschnitte und beide vollständigen Kontexte.
Die Klangabnahme dieses einmaligen Versuchs ist offen.

## 15. Abschluss ohne Treffpunkt

Der gemeinsame D02-Text für Browserstimme, Hallensprecher und Hallensprecherin
lautet am Ende jetzt `Das Spiel ist in Vorbereitung!`, falls die Treffpunktfunktion
ausgeschaltet oder der zugehörige Treffpunkttext leer ist. Ein nichtleerer aktiver
Treffpunkt wird weiterhin verwendet. Gezielt ausgelöste Zweitaufrufe sind eigene
Vorlagen und werden durch diese Änderung nicht umgeschrieben.

`http://127.0.0.1:8084/vorbereitung-abschluss/` vergleicht die bisherige und die
korrigierte Montage mit beiden Stimmen. Eine vollständige Kontextaufnahme je
Stimme liefert beide Ausschnitte für Anfang und Abschluss:

```text
In Vorbereitung! Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Muhammad Sytsh Abdulquddus gegen Max Hahn. Das Spiel ist in Vorbereitung!
```

Die Montage verwendet Anfang und Abschluss aus derselben vollständigen
Kontextaufnahme sowie den bereits bestätigten Spielblock. Eine Quellaufnahme je
Stimme liefert beide Ausschnitte.
Die Quelle lag bereits im Cache: Für diese Korrektur musste nur der Anfang neu
ausgeschnitten werden, ohne weitere Sprachgenerierung.

Der vorherige Versuch hatte für den Vergleich nur den Schluss ersetzt und den
Anfang aus einer älteren Kontextaufnahme übernommen. Er bleibt unter
`/vorbereitung-abschluss-getrennt/` als früherer Vergleich erhalten. Der Vergleich
mit der korrigierten gemeinsamen Quelle liegt unter `/vorbereitung-pausen-alt/`.
Originale und Schnittstellen sind sichtbar. Die Klangabnahme ist offen;
die Änderung liegt im v2-Experimentierbranch.

## 16. Pausen innerhalb der Satzstücke: höchstens 100 ms

Für die abgespielten Satzstücke gilt eine Obergrenze von 100 ms für zusammenhängende
fast vollständige Stille. Überlange stille Innenbereiche werden in Wiedergabekopien
auf etwa 80 ms gekürzt; Sprechtempo, aktive Sprachanteile und Satzgrenzen bleiben
erhalten. Die Pausen zwischen vollständigen Sätzen werden gesondert behandelt.
Die unveränderten Rohaufnahmen bleiben zum Vergleich und für spätere Schnitte erhalten.

Die zuvor als Q07 angezeigte Männerquelle hatte zwischen „In“ und „Vorbereitung“
150 ms fast vollständige Stille. Die neue Quellprüfung verwirft in dieser Wendung
bereits Pausen über 100 ms, auch in vorhandenen Cache-Aufnahmen. Nach dem ebenfalls
verworfenen Seed 43 wurde Seed 44 übernommen. Die Hallensprecherin verwendet ihre
vorhandene Aufnahme mit Seed 43. Anfang und Abschluss stammen weiterhin jeweils
aus derselben Kontextaufnahme. Der aktuelle Hörstand steht unter
`http://127.0.0.1:8084/vorbereitung-abschluss/`; der vorherige Stand bleibt als
Vergleich unter `/vorbereitung-pausen-alt/` erhalten.

## 17. Pegelabgleich je Baustein

Der aktuelle Hörstand gleicht jeden Wiedergabebaustein vor dem Zusammensetzen
nach EBU-R128-Lautheit ab. Der Hallensprecher verwendet −23 LUFS, die Hallensprecherin
erhält mit −22 LUFS eine zusätzliche Anhebung um 1 dB. Die True-Peak-Obergrenze
liegt bei −1,5 dBTP. Die fertige Montage erhält keinen erneuten RMS-Abgleich,
damit die Abstimmung der Bausteine und Stimmen bestehen bleibt.

Der Abgleich verändert ausschließlich die Verstärkung der Wiedergabekopien.
Schnittpositionen, Tempo, Pausen und Kontextquellen bleiben erhalten. Die
Einzelproben verwenden dieselben Pegel wie die Teile der zusammengesetzten Ansage.
Die aktuellen Proben samt Vorher-/Nachher-Vergleich stehen weiterhin unter
`http://127.0.0.1:8084/vorbereitung-abschluss/`. Der vorherige Pegelstand ist unter
`/vorbereitung-pegel-alt/` archiviert. Es ist keine neue Sprachgenerierung nötig.

## 18. Gemeinsame Regeln für alle lokalen Ansagearten

Auf Wunsch des Betreibers gelten der Pegelabgleich aus Abschnitt 17 und die
100-ms-Regel innerhalb eines Satzes aus Abschnitt 16 jetzt als gemeinsame
Wiedergabeaufbereitung für alle lokalen Ansagearten und beide Stimmen im
Experimentierbranch. Das umfasst auch direkte/freie Texte und vollständige
Spielblöcke. Echte Satzpausen werden anhand lokaler Wortanker erhalten; die
geplanten Übergangspausen zwischen Bausteinen bleiben bestehen.

Die fertig bearbeiteten Aufnahmen werden dauerhaft gespeichert und direkt
wiederverwendet, auch nach Neustart. Bereits vorhandene Originalaufnahmen
benötigen keine neue Sprachgenerierung. Die Originale bleiben für weitere
Schnitte erhalten. Künftige v2-Hörlaborläufe verwenden dieselbe Verarbeitung und
denselben dauerhaften Wiedergabecache. Alte Hörvergleiche werden nicht überschrieben.

BTS und Sprachserver verhandeln `bts-playback-v1` mit eigener
Verarbeitungsversion. Das ändert weder die Syntheseschlüssel noch die vereinbarte
Textstrategie. Technische Integration: [Lokale Sprachausgabe](local-tts-integration.md).
Die gesicherte v1 und laufende Produktivprozesse werden dadurch nicht automatisch ersetzt.

## 19. B08 in v2: Rollenaufnahme wiederverwenden

Für die Offiziellen wird in v2 bevorzugt eine gemeinsame Rollenbezeichnung aus
einem vollständigen Kontext gewonnen und mit vorhandenen Namens-/Teamstücken
verbunden. Der Betreiber bevorzugt diese Variante ausdrücklich wegen des
geringeren Generierungsaufwands. Zunächst wird die Tabletbedienung mit beiden
Stimmen und Einzel-/Doppelteam geprüft. Der bisherige v1-Entwurf in Abschnitt
7.3 B bleibt als Vergleich erhalten; eine zusätzliche Rollen-/Namensgenerierung
ist in v2 nur bei einem im Hörtest belegten Bedarf vorgesehen.

Aufbau und geplanter Hörvergleich stehen im
[v2-Plan, Abschnitt 5.0](context-v2-plan.md#50-bevorzugter-b08-aufbau-gemeinsame-rolle--vorhandenes-team).

Die Tablet-Hörprobe wurde bestätigt. Die folgenden gemeinsamen Rollenstücke
für Schiedsrichter, Aufschlagrichter und Klapptafelbedienung liegen mit beiden
Stimmen unter `http://127.0.0.1:8084/offizielle/`. Je Rolle und Stimme gibt es
eine Quelle; alle sechs Quellen bestehen im ersten Versuch. Vorhandene Namen,
Teams, Spiel- und Feldstücke werden bytegleich wiederverwendet. Die Seite zeigt
28 Proben, nach Rolle und Aufbau filterbar. Der anschließende Namensvergleich
einschließlich dieser Rollen wurde mit beiden Stimmen bestätigt („passt alles!“);
die gesicherte v1 bleibt unverändert.

Fehlende Namen technischer Offizieller werden im v2-Labor jetzt nach demselben
Muster wie Spielernamen geplant: `[Name] spielt jetzt gegen [Name]!`.
Das zweite Namensvorkommen ohne „gegen“ wird je Name und Stimme einmal gewonnen
und rollenübergreifend wiederverwendet. Vorhandene passende Einzelnamen kommen
direkt aus dem Cache; Personen werden nicht aus einem Doppel herausgeschnitten.
Es werden nur explizit angeforderte Richter vorbereitet, keine gesamte Namensliste.
Der Vergleich unter `http://127.0.0.1:8084/offizielle-namen/` zeigt den neuen
Namen Tim Lehr bei beiden Richterrollen und Max Hahn als Cache-Treffer, jeweils
mit beiden Stimmen. Details und Schnittwarnungen stehen im
[v2-Plan, Abschnitt 5.0.2](context-v2-plan.md#502-fehlende-namen-technischer-offizieller).

Die aktuellen Proben sind mit beiden Stimmen klanglich bestätigt, einschließlich
des markierten Namensanfangs von Tim Lehr bei der Hallensprecherin. Die Bestätigung
gilt den konkreten Aufnahmen. Als nächster Hörbereich sind B11-Zweitaufrufe mit
vorhandenen Teams, Rollen und Location-Texten vorgesehen; danach die D12-Kampflos-Klausel.

## 20. B11 im v2-Hörlabor: Zweitaufrufe D04–D11

`http://127.0.0.1:8084/zweitaufrufe/` enthält pro Stimme 20 vollständige
Zweitaufrufe sowie drei Einzelbausteine und zwei Kontextreferenzen. Normale
Teamaufrufe, Vorbereitungsaufrufe, Richter und Tablet-/Klapptafelbedienung werden
mit vorhandenen Namen und Teams zusammengesetzt. Die Offiziellen-Aufrufe werden
zusätzlich ohne zugewiesenes Feld geprüft. Es gibt keine neuen Turnierzuordnungen.

Der Männerbaustein `Zweiter Aufruf für:` ist bereits vorhanden. Je Stimme wird
der Vorbereitungskontext aus Abschnitt 5.0.3 des v2-Plans erzeugt; er liefert
das gemeinsame Vorbereitungspräfix und `bitte als Tabletbedienung`. Für die
Hallensprecherin kommt die normale Präfixquelle hinzu. So entstehen drei
verwendete neue Quellen; vier Kandidaten waren einschließlich einer wegen
Pausen verworfenen Frauenaufnahme nötig. Bestehende Wiedergabestücke werden
ohne erneute Bearbeitung übernommen.

Der gespeicherte Location-Stand ist Campus Helleweg ohne Hallenzusatz und ohne
aktiven Treffpunkt. Wortlaut und Reihenfolge kommen aus den Browserfunktionen;
Location-Varianten und Einzahl-/Mehrzahlformen sind im Planer berücksichtigt.
Der aktuelle D11-Wortlaut bleibt auch bei Klapptafeln erhalten. Das Hörlabor
schreibt keine Browsertexte um. Pausen rechnen Randstille an: 140 ms nach dem
Präfix, 80 ms nach der Rolle, bei Klapptafeln 180 ms; 320 ms vor dem wiederholten
Namen. Der Betreiber hat diesen Hörsatz für beide Stimmen klanglich bestätigt
(„Passt!“). Die Bestätigung gilt den konkreten Aufnahmen und dem gespeicherten
Location-Stand. Als nächster offener Hörbereich folgt D12.

## 21. D12 im v2-Hörlabor: Siegerteam nach „gegen“

`http://127.0.0.1:8084/kampflos/` enthält die Kampflos-Hörproben mit beiden
Stimmen. Auf Wunsch wird das Siegerteam aus der zweiten Position seiner
`[Team] spielt jetzt gegen [Team]!`-Quelle übernommen, ohne „gegen“. Im Einzel
gewinnt Max Hahn, im Doppel Emil Hermann und Konrad Wendt, jeweils die zweite
Seite der vorhandenen Beispielbegegnung. Es werden keine Ergebnisse eingetragen.

Je Stimme liefert eine vollständige Kontextaufnahme mit Spiel 161 den gemeinsamen
Ausschnitt `Das Spiel geht kampflos an`. Die tatsächlichen Montagen verwenden die
vorhandenen Spiel- und Siegerteamstücke, keine neuen Namensaufnahmen. Aufbau:
bestätigter Spielblock → Kampflos-Klausel → zweiter Team-Ausschnitt. Pausenziele:
300 ms vor der Klausel und 100 ms zum Sieger einschließlich vorhandener Randstille.
Es gibt zwölf Proben mit vollständigen Ansagen, kurzen Ergebnissätzen, der Klausel
allein und den Kontextreferenzen. Nummern bleiben in der Anzeige Ziffern.

Beide neuen Quellen bestehen mit Seed 42. Der Schnitt der Hallensprecherin wird
wegen einer längeren Satzpause vor der Klausel anhand unabhängiger lokaler
Wortanker bestimmt, aus derselben Aufnahme und ohne zusätzliche Synthese. Das
Ende von „an“ liegt bei beiden Stimmen in aktiver Sprache; diese Übergänge sind
zur Hörprüfung markiert. Bestehende Schnittwarnungen bleiben ebenfalls sichtbar.
Der Betreiber hat diese konkreten Einzel- und Doppelproben mit beiden Stimmen
klanglich bestätigt („Passt so!“), einschließlich der markierten Übergänge zum
Siegerteam. Die Schnittbefunde bleiben dokumentiert. Details im
[v2-Plan](context-v2-plan.md#504-d12-gemeinsame-kampflos-formulierung-und-siegerteam-nach-gegen).

## 22. Anmeldung / Anwesenheitskontrolle: Bestandsaufnahme und v2-Entwurf

Auf Wunsch wird die Anmeldung jetzt zusätzlich betrachtet. Dieser Abschnitt
erfasst vorhandene Texte und schlägt ihre Stückelung vor. Noch keine neue
Generierung, produktive Textänderung oder Anmeldung-/Statusänderung.

### 22.1 Vorhandene Aufrufe

Quelle: `static/js/ctournament.js`, `registration_control_announcement_text`.
Die vier Aufrufarten haben jeweils zwei Ziele: `Anmeldung` und `Turnierleitung`.
Damit bestehen acht Vorlagen, jeweils mit den vollständigen tatsächlichen Namen.

| Aufrufart | Aktueller Wortlaut; `{Ziel}` ist Anmeldung oder Turnierleitung |
| --- | --- |
| Spieler | `{Name} bitte zur {Ziel}. {Name} bitte!` |
| Paarung | `Die Paarung {Name 1} und {Name 2} bitte zur {Ziel}. {Name 1} und {Name 2} bitte!` |
| Verein | `Bitte ein Vertreter vom Verein {Verein} zur {Ziel}. Ein Vertreter vom Verein {Verein} bitte!` |
| Bundesland | `Bitte ein Vertreter aus {Bundesland} zur {Ziel}. Ein Vertreter aus {Bundesland} bitte!` |

Der Dialog bietet genau die beiden Ziele an. Personen, Paarungen, Vereine und
Bundesländer sind über die jeweiligen Tabellenzellen aufrufbar. Die Paarung
wird gesprochen mit „und“ verbunden, auch wenn die Tabelle einen Schrägstrich
anzeigt. Disziplin, Altersklasse und Runde werden derzeit nicht gesprochen;
der übergebene Event-Parameter wird vom Textbuilder nicht verwendet.
Die bestehenden Ausspracheersetzungen werden auf das aufgerufene Label angewendet.

`trigger_registration_announcement` sendet den vollständig zusammengesetzten Text
als `free_announce`; `static/js/change.js` gibt ihn über den Pfad für freie Ansagen
aus. Die v2-Bausteinplanung und gezielte Vorabvorbereitung dieser Vorlagen fehlen
noch. Die bestehenden Freigaben für freie Ansagen bleiben maßgeblich.

### 22.2 Bereits wiederverwendbar

Vollständige Spieler- und Paarungsaufnahmen werden zuerst im v2-Namenscache
gesucht, mit passender Stimme, Aussprache und Position. Beide Namen eines Doppels
bleiben zusammen. Ein nur innerhalb eines Doppelteams vorhandener Einzelspieler
bekommt bei Bedarf seinen eigenen vollständigen Namenskontext; Einzelwörter oder
Personen werden nicht aus Doppelaufnahmen herausgeschnitten.

Vor „bitte“ sollte zunächst die bereits gewonnene erste Position aus
`[Name/Team] spielt jetzt gegen [Name/Team]!` geprüft werden. Die zweite Position
ist ebenfalls vorhanden beziehungsweise ohne neue Synthese aus derselben Quelle
gewinnbar. Welche Position hier natürlicher klingt, ist ein neuer Hörvergleich;
die D12-Entscheidung für das Siegerteam legt diese Anmeldungssituation nicht fest.

### 22.3 Feste Stücke und Kontextquellen als Prüfentwurf

Zehn gemeinsame Wiedergabestücke je Stimme reichen als erster Prüfentwurf für
alle acht Vorlagen, zusätzlich zu den variablen Namen beziehungsweise Labels:

| Nr. | Vorgeschlagenes festes Stück |
| --- | --- |
| 1 | `bitte zur Anmeldung.` |
| 2 | `bitte zur Turnierleitung.` |
| 3 | `zur Anmeldung.` |
| 4 | `zur Turnierleitung.` |
| 5 | `Die Paarung` |
| 6 | `Bitte ein Vertreter vom Verein` |
| 7 | `Ein Vertreter vom Verein` |
| 8 | `Bitte ein Vertreter aus` |
| 9 | `Ein Vertreter aus` |
| 10 | `bitte!` |

Die Stücke mit und ohne „bitte“ sind nötig, weil beim Vereins-/Bundeslandaufruf
das erste „Bitte“ bereits in der Einleitung steht. Dieselbe Zielaufnahme samt
einem zusätzlichen „bitte“ würde den heutigen Wortlaut verändern. Beide
Zielvarianten können dennoch aus derselben vollständigen Quelle ausgeschnitten
werden. Der Satzanfang `Bitte ein Vertreter …` und die Wiederholung
`Ein Vertreter …` erhalten ebenfalls ihre tatsächlichen Positionen im Kontext.

Für einen ersten Hörsatz eignen sich vier vollständige Kontexttypen:

1. Person zur Anmeldung: liefert beide Anmelde-Zielstücke sowie `bitte!`.
2. Paarung zur Turnierleitung: liefert `Die Paarung` und beide Turnierleitungs-Zielstücke.
3. Vereinsaufruf: liefert beide Vereins-Einleitungen und den Vereinsnamen in beiden Positionen.
4. Bundeslandaufruf: liefert beide Bundesland-Einleitungen und das Bundesland in beiden Positionen.

Die Quellen verwenden den vollständigen heutigen Aufruf mit Wiederholung.
Die variablen Namen werden in den Montagen aus ihrem passenden vorhandenen Cache
eingesetzt. Die erste nötige Vereins-/Bundeslandaufnahme kann zugleich die
gemeinsamen Einleitungen liefern; dafür soll keine separate Generierung erfolgen.
Weitere bislang fehlende Vereins-/Bundeslandlabels benötigen nur ihren eigenen
vollständigen Kontext, gemeinsam für beide Zielorte. Eine Quelle kann beide
Positionsausschnitte liefern. Es entsteht kein Auftrag je Kombination von Name,
Ziel und Durchsage.

Die zehn Stücke sind ein Hörentwurf, keine klanglich bestätigte Gesamtzahl.
Übergänge vor „bitte“ und „zur“ sowie beide Namenswiederholungen müssen mit beiden
Stimmen geprüft werden. Zahlen werden wie bisher vor der lokalen Synthese
ausgeschrieben; Anzeige und Browserwortlaut bleiben erhalten. Die gemeinsamen
100-ms-/LUFS-Regeln gelten auch für diese künftigen lokalen Bausteine.

### 22.4 Vorabplanung

Für die spätere Integration müssen diese Vorlagen zuerst aus dem freien Textpfad
in eine gemeinsame, vom Browser und Backend verwendbare Text-/Bausteinplanung
überführt werden. Der Browserwortlaut bleibt dabei die Referenz. Angeforderte
Aufrufe werden sofort vervollständigt; weitere Vorarbeit richtet sich nach den
aktiven Anmeldedisziplinen und den noch offenen Personen. Weiterer Vorrat kommt
erst im Leerlauf, unter Beibehaltung der bestehenden Priorisierung der Spielansagen.
Bereits fertig erzeugte Aufnahmen bleiben im dauerhaften Cache. Das ist noch
kein implementierter Warteschlangenauftrag.

Die Bestandsaufnahme wurde direkt mit den acht vorhandenen Textbuilder-Ausgaben
geprüft. Produktionscode und bestehende D01–D15/B01–B12 wurden nicht verändert.

### 22.5 Erster Anmelde-Hörsatz mit beiden Stimmen

Hörseite: `http://127.0.0.1:8084/anmeldung/`. Die vier Aufrufarten stehen jeweils
für Anmeldung und Turnierleitung zur Verfügung. Person: Muhammad Sytsh Abdulquddus;
Paarung: Ben Hensel und Max Wächtler. „PSV Bremen“ und „Bremen“ sind ausdrücklich
Hörbeispiele für Verein und Bundesland; es werden keine Turnierzuordnungen gesetzt.

Der Hörsatz verwendet die zehn festen Stücke aus 22.3. Vier vollständige
Kontextaufnahmen pro Stimme liefern diese Stücke sowie Vereinsname und Bundesland
an ihren jeweils zwei tatsächlichen Positionen. Der Einzelname und das ganze
Doppelteam werden bytegleich wiederverwendet, beide vor „bitte“ aus der ersten
Position ihrer vorhandenen `[Team] spielt jetzt gegen [Team]!`-Aufnahme.
Die Personen-/Teamwörter in den neuen Kontextquellen dienen ausschließlich als
Kontext und ersetzen diese bestehenden Namensstücke nicht.

Pro Stimme: acht zusammengebaute Aufrufe, 14 neue Stücke einzeln und vier vollständige
Kontextreferenzen, insgesamt 26 Hörproben. Es entstehen 18 neue Schnitt-/Referenzstücke;
zwei vorhandene Namens-/Teamstücke werden übernommen. Es gibt keine separate
Generierung pro Kombination von Name, Ziel und Aufrufart. Pausenziele einschließlich
Randstille: 80 ms innerhalb eines Satzes, 320 ms zwischen beiden Sätzen. Die gemeinsamen
100-ms-/LUFS-Regeln sowie Stimmenreferenzen und Tempo bleiben erhalten.

`scripts/tts-registration-plan.js` liest den echten bestehenden Browserbuilder
aus `ctournament.js` in einer isolierten VM und vergleicht jede Montage mit dessen
Ausgabe. Die Browsertexte werden nicht verändert. Die Hörseite zeigt für jedes
Stück Quelle, Kontextmarkierung, Schnitt und Rohaufnahme. Dies ist die Hörprüfung
der Anmeldebausteine; die produktive Anmelde-Warteschlange bleibt noch unverändert.

Der Betreiber hat diesen Anmelde-Hörsatz für beide Stimmen klanglich bestätigt
(„Passt!“). Die Bestätigung umfasst die vier Aufrufarten mit beiden Zielorten,
die gemeinsamen festen Stücke und die Wiederverwendung der vollständigen Namen
vor „bitte“. Vorhandene automatische Schnittbefunde bleiben dokumentiert.

### 22.6 Aktueller Stand: Vereine und Bundesländer im Namenskontext

Auf Wunsch des Betreibers verwenden auch Vereinsnamen und Bundesländer denselben
Kontextsatz wie Personen und Teams:

```text
[Bezeichnung] spielt jetzt gegen [Bezeichnung]!
```

Für den Hörtest werden `PSV Bremen spielt jetzt gegen PSV Bremen!` und
`Bremen spielt jetzt gegen Bremen!` mit beiden Stimmen erzeugt. Jeweils das erste
vollständige Vorkommen vor „spielt“ wird ausgeschnitten. Dasselbe Stück wird
sowohl vor dem Zieltext als auch vor dem abschließenden „bitte!“ verwendet.
Damit reicht je Verein oder Bundesland ein Stück für beide Wiederholungen und
beide Ziele. Die Kontextwörter „spielt jetzt gegen“ werden nicht mit abgespielt.
Dies ersetzt die beiden bisherigen Positionsstücke aus dem eigentlichen
Vereins-/Bundeslandaufruf in 22.3 und 22.5. Deren klangliche Bestätigung bleibt
für den vorherigen Hörstand dokumentiert.

Die zehn festen Aufrufstücke, die beiden vorhandenen Namen-/Teamstücke und die
vier vollständigen ursprünglichen Aufrufkontexte bleiben bytegleich im Cache.
Für diese Änderung werden je Stimme nur zwei neue Kontextquellen benötigt.
Sie liefern zwei Bezeichnungsstücke und zwei vollständige Vergleichsreferenzen.
Alle acht montierten Aufrufe behalten ihren Browserwortlaut und ihre Pausenziele.
Die bestehenden 100-ms-/LUFS-Regeln gelten auch für die neuen Stücke.

Aktuelle Hörseite: `http://127.0.0.1:8084/anmeldung-namenskontext/`.
Der vorige Hörsatz bleibt unter `anmeldung/` zum Vergleich verfügbar.
Pro Stimme gibt es weiterhin 26 Proben: acht Aufrufe, zwölf einzelne feste oder
variable Stücke und sechs Kontextreferenzen. Insgesamt 20 Wiedergabestücke:
zehn feste Stücke, vier Bezeichnungen einschließlich Person und Paarung sowie
sechs vollständige Referenzen. 16 davon werden für diese Änderung wiederverwendet,
vier neu aus den zwei Bezeichnungsquellen gewonnen. Weitere Bezeichnungen können
dieselbe Namensplanung und denselben Cache nutzen.

## 23. B02: vollständiger Feldsatz für vorbereitete Spiele

Der Betreiber legt fest: `Für Spielfeld [Nummer]!` wird als vollständiger Satz
für jedes vorhandene Feld erzeugt. Ein zusätzlicher Kontextsatz und Textschnitte
sind dafür nicht nötig. Es gelten die vorhandenen Qualitätsprüfungen und die
gemeinsame dauerhafte 100-ms-/LUFS-Aufbereitung.

`scripts/tts-preparation-field-plan.js` liest die tatsächlichen Feld-IDs und
übernimmt den vollständigen Text aus derselben Browserfunktion
`createFieldPreparationAnnouncement`. Die Zahl wird nur vor der Synthese
ausgeschrieben. Die Anzeige behält Ziffern. Gleiche gesprochene Feldsätze teilen
ihre Quelle; Spiel, Halle, Namen und Offizielle erzeugen keine weiteren
Varianten desselben Feldsatzes. Ein weiteres Feld benötigt nur seinen fehlenden
Satz pro Stimme. Vorhandene Aufnahmen bleiben im Cache.

Der gespeicherte Turnierstand enthält die Felder 1 bis 13. Für den Hörvergleich
werden beide Stimmen vorbereitet: 13 Quellen und 13 vollständige Wiedergabestücke
je Stimme, insgesamt 26. Der laufende Turnierbetrieb wird weiterhin erst bei der
späteren Integration auf die neue Strategie umgestellt und bereitet dann nur
die zentral gewählte Stimme vor.

Hörseite: `http://127.0.0.1:8084/vorbereitung-spielfeld/`.
Sie enthält je Stimme 13 einzelne Feldsätze und 13 vollständige Vorbereitungsaufrufe.
Feld und Probe sind auswählbar; zunächst ist Feld 8 mit beiden Stimmen sichtbar.
Die zusätzlichen Vorbereitungsaufnahmen sind reine Montagen und brauchen keine
weitere Synthese:

```text
In Vorbereitung!
→ Für Spielfeld [Nummer]!
→ Spielnummer 161. Jungen Einzel U17. Achtelfinale!
→ Muhammad Sytsh Abdulquddus gegen Max Hahn.
→ Schiedsrichter: Tim Lehr.
→ Aufschlagrichter: Max Hahn.
→ Tabletbedienung: Emil Hermann und Konrad Wendt.
→ Das Spiel ist in Vorbereitung!
```

Die Rollenbesetzungen sind Hörbeispiele. Die gespeicherte Location hat keinen
Vorbereitungszusatz und keinen aktiven Treffpunkttext. Alle 13 gemeinsamen
Spiel-, Rollen-, Namens- und Vorbereitungsstücke je Stimme bleiben bytegleich.
Für diese Montagen werden keine Namen, Spielblöcke oder Offiziellen neu erzeugt.
Für B02 beträgt das Pausenziel davor und danach 250 ms einschließlich Randstille;
Spielblock und Rollen behalten ihre bestätigten inneren Pausenziele.

Die bisherigen Vorbereitungsstücke entstanden bereits mit denselben Lautheits-
und Pausenregeln vor dem dauerhaften Cache-Wrapper. Ihre gemessene Regelidentität
wird vor dem Wiederverwenden geprüft; auch der vorhandene Abschluss wird ohne
erneute Bearbeitung übernommen. Originale, frühere Hörseiten und produktive v1
bleiben erhalten.

Der Hörsatz ist vollständig erzeugt: Alle 13 Feldquellen beider Stimmen bestehen
die unveränderte Qualitätsprüfung. Beim Hallensprecher wird Feld 10 einmal
wiederholt. Bei der Hallensprecherin benötigen Feld 7 und 9 nach jeweils drei
verworfenen Kandidaten eine weitere begrenzte Passage mit gezielt anderem
Startseed. Nur diese fehlenden Quellen werden neu erzeugt; die elf bereits
fertigen bleiben bytegleich. Tatsächlicher Aufwand: 14 männliche und 22 weibliche
Kandidaten, davon einer beziehungsweise neun verworfen. Beide Stimmen liefern
danach 13 gültige Feldaufnahmen. Die vollständigen Montagen und reinen Cache-Läufe
sind geprüft; beim Wiederholen entstehen keine neuen Synthesen.

Der Betreiber hat diesen Hörsatz mit „Passt!“ klanglich bestätigt. Damit sind
die vollständigen B02-Feldsätze für Feld 1 bis 13 und ihre Einbindung in die
gezeigten D02-Vorbereitungsaufrufe für beide Stimmen abgenommen. Die Festlegung
bleibt: ein vollständiger Satz je Feld, ohne zusätzlichen Kontextsatz und ohne
Textschnitte, mit den gemeinsamen Qualitäts-, Pausen- und Lautheitsregeln.
Vorhandene automatische Befunde der wiederverwendeten Stücke bleiben dokumentiert.
