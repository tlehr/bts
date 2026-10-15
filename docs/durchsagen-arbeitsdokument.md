# BTS-Durchsagen – Arbeitsdokument

Stand: 16.10.2026 · Branch: `feat/localTts`

Diese Datei ist unsere gemeinsame Grundlage, um Wortlaut, Reihenfolge und Stückelung der Turnierdurchsagen zu bearbeiten. Die Kennungen D01–D15 und B01–B12 bleiben bei Überarbeitungen erhalten, damit wir einzelne Stellen eindeutig benennen können.

Die Anwesenheitskontrolle bleibt vorerst außerhalb dieser Betrachtung. Die Datei beschreibt den aktuellen Programmstand und hält in Abschnitt 7 unsere Vereinbarungen für die Überarbeitung fest. Änderungen hier werden anschließend ausdrücklich in die Anwendung übertragen; BTS liest diese Markdown-Datei nicht als Konfiguration.

## 1. Ziel und bisherige Hörentscheidung

- Möglichst lange, natürlich klingende Satzstücke verwenden.
- Wiederholte Inhalte möglichst aus bereits erzeugten Aufnahmen abspielen.
- So wenig wie möglich und so viel wie nötig generieren. Bereits passende Aufnahmen werden wiederverwendet.
- Den gesprochenen Inhalt zunächst erhalten; die Stückelung darf sich ändern.
- Vollständige Namen zusammenhalten. Übergänge zwischen Namen, „und“ und „gegen“ sollen natürlich klingen.
- Zahlen vor der lokalen Synthese ausschreiben; in der Anzeige bleiben Ziffern erhalten.
- Für Browser-TTS und lokale Generierung dürfen unterschiedliche Strategien verwendet werden.
- Klangliches Ziel ist der deutlich bevorzugte zusammenhängende Hörtest **Variante 1**.

Im Hörtest **Variante 5** wurde die separat erzeugte Spielfeldansage als unnatürlich bewertet. **Variante 6** übernimmt deshalb Anfangs- und Schlussansage aus Variante 1 und setzt den Spielblock aus Variante 5 dazwischen. Diese Aufnahme steht zum Vergleich bereit. Die vereinbarte Erstellung von B01-Anfang und B01-Ende für alle Felder greift dieses Vorgehen auf (Abschnitt 7.1); ihre Umsetzung für den Turnierbetrieb steht noch aus.

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

**Spielblock** bezeichnet in den folgenden Vorlagen diese Reihenfolge:

```text
B03 Spielnummer
→ B04 Disziplin / Altersklasse
→ B05 Runde
→ B07 Beide Teams
```

Die Offiziellen B08 stehen bei regulären Spiel- und Vorbereitungsaufrufen anschließend in der Reihenfolge Schiedsrichter, Aufschlagrichter, Bedienung. Es werden nur die jeweils zugeordneten Rollen ausgegeben. Die Bedienung kann einen oder zwei Namen enthalten.

### 3.1 Disziplinen und Runden

Die aktuellen deutschen Disziplintexte sind:

| Kürzel | Aktueller Text |
| --- | --- |
| JE | `Jungeneinzel` |
| JD | `Jungendoppel` |
| ME | `Maedchenneinzel` |
| MD | `Maedchendoppel` |
| GD / MX | `Gemischtes Doppel` |
| HE | `Herreneinzel` |
| HD | `Herrendoppel` |
| DE | `Dameneinzel` |
| DD | `Damendoppel` |
| E | `Einzel` |
| D | `Doppel` |

Die Schreibweisen `Maedchenneinzel` und `Maedchendoppel` stehen tatsächlich in der deutschen Sprachvorlage. Der Alters-/Klassenzusatz kommt aus dem Veranstaltungsnamen hinzu. Vorhandene Ausspracheersetzungen für Namen werden ebenfalls berücksichtigt.

Bei den Runden werden `R16`, `VF`, `HF` und `Finale` in die entsprechenden Rundennamen übersetzt. Eine Bezeichnung mit Bindestrich ergibt `Zwischenrunde`. Platzierungsangaben mit `/` werden abhängig vom Abstand als „Runde um Platz … bis …“ oder „Spiel um Platz … und …“ aufgebaut. Im aktuellen Code fehlen dabei teilweise Leerzeichen: Beispielsweise ergeben `1/4` und `3/4` die Texte `Runde um Platz1bis4` und `Spiel um Platz3 und 4`. Andere nicht erkannte Rundennamen ergeben einen leeren Rundentext.

### 3.2 Einstellbare Varianten

- Spielnummer B03, Disziplin B04 und Runde B05 lassen sich jeweils ausschalten.
- Die Halle kann einen eigenen Vorbereitungszusatz und einen eigenen Treffpunkttext haben. Ein leer hinterlegter Treffpunkttext bleibt leer.
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

Für die geplante lokale Fassung ist vereinbart: Am Anfang wird **B01-Anfang** des jeweiligen Feldes verwendet, am Schluss **B01-Ende** desselben Feldes. Die Aufnahmegrenzen des Mittelteils und der Offiziellen bleiben offen. Erstellung und Wiederverwendung der Feldaufnahmen sind in Abschnitt 7.1 festgelegt.

### D02 – Vorbereitungsaufruf

Auslöser: Ein Spiel wird in Vorbereitung aufgerufen.

```text
B09 In Vorbereitung {Hallenzusatz}
→ B02 Für Spielfeld {Feld}!
→ Spielblock
→ B08 Zugeordnete Offizielle
→ B10 Treffpunkt
```

Ohne aktivierte Treffpunktfunktion wird am Ende stattdessen B09, also `In Vorbereitung {Hallenzusatz}`, wiederholt. Ein noch nicht zugewiesenes Feld lässt B02 entfallen.

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

Der erste Teil verwendet die bereits aus dem vollständigen Referenzaufruf ausgeschnittene Aufnahme **B01-Anfang**. D03 benötigt dafür keine zusätzliche Generierung der Spielfeldansage. Wie die Aufnahme für B12 erstellt wird und welche Übergangspause verwendet wird, bleibt noch festzulegen.

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
→ {Team 1} gegen {Team 2} geht kampflos an {Siegerteam}!
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

Der aktuelle produktive lokale Plan zerlegt die Abschnitte anhand ihrer bekannten Struktur weiter. Die folgende Tabelle zeigt die sichtbaren Bausteintexte vor dem Ausschreiben der Zahlen für die Synthese:

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

**Noch offen:** Ob und wie wir aus den Referenzaufnahmen zusätzlich andere Bausteine gewinnen, legen wir bei den nächsten Schritten fest. B02 („Für Spielfeld …!“) ist durch diese Festlegung noch nicht abgedeckt.

### 7.2 Weitere Entscheidungen

Die übrigen Punkte können wir direkt in dieser Datei festlegen:

| Thema | Zu entscheiden | Vereinbarung |
| --- | --- | --- |
| Feldansage | Wie entstehen die Aufnahmen für Anfang und Schluss? | B01-Anfang und B01-Ende je Feld aus derselben vollständigen Referenzaufnahme; erste Vorbereitungsstufe für alle Felder (Abschnitt 7.1) |
| Referenzaufruf | Welcher Mittelteil wird für die erstmalige Erstellung der Feldaufnahmen gesprochen? | Festgelegter Beispiel-Spielblock aus Abschnitt 7.1: Spiel 189, Mädcheneinzel U19, Achtelfinale, Nina Keo Boun Khoune gegen LeandraGalowicz; wortgetreu mit ausgeschriebenen Zahlen und unverändert für alle Felder |
| Einsatz weiterer Feldansagen | Welche B01-Ausschnitte verwenden andere Durchsagen? Wie wird B02 erstellt? | D03 verwendet B01-Anfang des jeweiligen Feldes; weitere Verwendungen und die Erstellung von B02 bleiben offen |
| Spielblock | Welche Angaben bleiben gemeinsam in einer langen Aufnahme? | Offen |
| Namen und Paarungen | Ein vollständiger Name je Aufnahme, ein Team oder beide Teams mit „gegen“? | Offen |
| Offizielle | Welche Rollen-/Namensstücke lassen sich natürlich zwischen normalen Aufrufen und Zweitaufrufen wiederverwenden? | Offen |
| Vorbereitung | Welche Hallen- und Treffpunkttexte bilden jeweils einen vollständigen Satz? | Offen |
| Zweitaufrufe | Wie viel Zusammenhang brauchen Präfix, Rolle, Name und Zielort? | Offen |
| Kampflos | Welche Aufnahmen können mit D01/D02 geteilt werden, ohne die andere Satzmelodie zu verlieren? | Offen |
| Pausen und Betonung | Welche Pausen gehören in die Aufnahme, welche setzen wir beim Abspielen? | Offen |
| Browser-TTS | Welche bestehende Abschnittsaufteilung behalten oder ändern wir dafür? | Offen |
| Vorab-Cache | Welche Varianten müssen vorbereitet werden, und welche erst nach einer tatsächlichen Änderung? | Zuerst B01-Anfang und B01-Ende für alle Felder; weitere Vorbereitungsstufen offen |

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
- B04: Die Sprachvorlage enthält `Maedchenneinzel` und `Maedchendoppel`.
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
