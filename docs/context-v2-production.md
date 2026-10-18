# Lokale Sprachausgabe mit Kontext v2

v2 verwendet die gemeinsam abgestimmten Hörlabor-Bausteine im normalen BTS.
Der HTTP-Vertrag bleibt unter `/v1`; das Syntheseprofil heißt `bts-context-v2`.
BTS übernimmt Auswahl, Reihenfolge und Zusammensetzen. Der Sprachserver
verarbeitet weiterhin genau einen Auftrag und lehnt weitere mit `429/busy` ab.

## Wiederverwendung

| Baustein | Aufnahme | Verwendung |
|---|---|---|
| Feldanfang/-ende | Vollständiger Referenzaufruf je Feld | Beide Feldpositionen aus derselben Aufnahme |
| Feld in Vorbereitung | `Für Spielfeld [F]!` | Ganzer Satz je Feld |
| Spielnummer | `Spielnummer [N] ist als nächstes an der Reihe.` | Bis vor „ist“ |
| Disziplin/Alter | `Im [Disziplin] [Alter] erwarten wir spannende Spiele!` | Zwischen „Im“ und „erwarten“; Disziplin mit Leerzeichen |
| Runde | `[Runde]!` | Ganzer Satz |
| Team/Name/Verein/Verband | `[Name] spielt jetzt gegen [Name]!` | Erste Position, zweite Position oder „gegen“ mit zweiter Position |
| Offiziellenrolle | Im Hörlabor gewählter vollständiger Rollen-Kontext | Rolle mit wiederverwendetem Namen |
| Vorbereitung | Standortabhängiger Kontextaufruf | Anfang und Abschluss aus derselben Quelle |
| Anmeldung/Zweitaufrufe/Kampflos | Im Hörlabor festgelegte Kontextaufnahmen | Gemeinsame Wörter mit Team-/Namensausschnitten |

Die vollständigen festen Rezepte stehen in `static/js/speech_context_v2.js`.
Die Browserstimme behält ihre Texte. Ziffern bleiben in der Anzeige erhalten;
BTS schreibt sie erst für die Anfrage an den Sprachserver aus.
Freie Texte und der Sprachtest bleiben vollständige Äußerungen, die bestehende
Evakuierungsdatei bleibt unverändert.

## Reihenfolge

1. Tatsächlich ausgelöste Durchsage; anschließend Sprachtest und angeforderte Proben.
2. Standort- und Feldbausteine, danach weitere gemeinsame Bausteine.
3. Vor der ersten Auslosung: Anmeldevorarbeit; gemeinsame Texte vor Bezeichnungen.
   Geöffnete/fortgeschrittene Disziplinen zuerst, Landesverbände vor Vereinen vor Personen/Paarungen.
4. Laufende Spiele nach Aufrufzeit; danach Spiele in Vorbereitung nach Vorbereitungsaufrufzeit.
5. Alle bekannten technischen Offiziellen, auch ohne Spielzuordnung.
6. Nur im Leerlauf: Aufrufkandidaten, weitere angesetzte Spiele, weitere
   Anmeldungen/Auslosungen nach Spielreihenfolge, weitere Teams laufender
   Disziplinen, verbleibende mögliche Tabletbediener.
7. Optional, erst nach vollständigem Leerlauf aller Turniere: andere Stimme.

Die Checkbox **„Andere Stimme nur bei vollständigem Leerlauf auf Vorrat vorbereiten“**
steht unter **Einstellungen → Aufrufe** und ist zunächst ausgeschaltet.
Ein laufender Auftrag wird beendet; danach wird die aktuelle Reihenfolge neu
bewertet. Entfallene ungesendete Aufträge werden entfernt, fertige Dateien bleiben.

## Cache, Qualität und Betrieb

Quellaufnahme, Ausschnitt und pegel-/pausenbearbeitete Abspielkopie haben getrennte,
persistente Cache-Einträge. v1-Dateien werden nicht gelöscht. v2-Schlüssel enthalten
das Profil und die Schnittimplementierung; Stimmen und Referenzen bleiben getrennt.
Passende Hörlabor-Quellen werden nur bei identischer Stimme, Modell, Parametern,
Text und überprüftem WAV-Hash übernommen. Dadurch entfällt eine erneute Synthese.
Die Schnitte verwenden immer die Wortzeiten der tatsächlichen Quelldatei.

Die im Hörlabor gewählte Vorbereitungsreferenz gilt für die Hallensprecherin.
Die Männerreferenz bleibt unverändert. Alle lokalen Abspielbausteine verwenden
die gemeinsame Pegelanpassung und maximal 100 ms Ruhe innerhalb eines Satzes;
Pausen zwischen Sätzen haben eigene Ziele. Quellen mit auffälligen langen Pausen
werden höchstens dreimal versucht. Danach bleibt der Fehler sichtbar;
Team-Ausschnitte nutzen die begrenzte Kontext-/Einzelnamen-Rückfallebene.

Der Server wird mit `BTS_CONTEXT_VERSION=bts-context-v2` aktiviert. Der weiterhin
vorhandene v1-Stand ist mit `bts-context-v1-stable` markiert. Für eine vollständige
Rückkehr müssen v1-Konfiguration, Stimmen und Datenverzeichnis aus dem gesicherten
Stand verwendet werden; die Details stehen im v1-Baseline-Dokument des Sprachservers.
Nach der Umstellung offene BTS-Browserseiten neu laden.

## Übersicht im Einstellungsbereich „Aufrufe“

Die Übersicht trennt zwei aufklappbare Bereiche:

- **Bausteine:** eindeutige abspielbare Audioteile, gruppiert nach Spielfeld,
  Spielnummer, Disziplin/Alter, Runde, Namen, Rollen und weiteren Textarten.
  Ein gemeinsamer Baustein zählt hier einmal.
- **Durchsagen:** vollständige mögliche Aufrufe, gruppiert nach D01–D14 sowie
  Anmeldung/Auslosung. Jede Spiel-, Team-, Orts- oder Personenvariante zählt als
  eigene Durchsage. Bereit bedeutet: alle zugehörigen Bausteine sind vorhanden
  und die erforderlichen Angaben stehen fest. Ein unbekanntes Spielfeld oder
  unbekannte Teilnehmer bleiben als solcher Hinweis sichtbar.

Jeder Bereich hat einen Gesamtbalken, jede Untergruppe einen eigenen Balken.
Darunter lässt sich die jeweilige Statusliste mit zunächst 30 Einträgen öffnen
und schrittweise erweitern. Eine Durchsage zeigt zusätzlich ihre Bausteine und
deren Status. Die Listen lesen ausschließlich den vorhandenen Stand; das Öffnen
erzeugt keine Sprachaufträge. Bei Statusänderungen werden geöffnete Listen
aktualisiert, aufgeklappte Einträge bleiben erhalten.

Blau bezeichnet fertigen Vorrat, Türkis den in dieser BTS-Sitzung vorsorglich
erstellten Vorrat. Dunkelgrün bezeichnet benötigte Teile aus dem Cache,
Hellgrün benötigte neu erstellte Teile, Orange beauftragte fehlende Teile und
Grau bekannte Möglichkeiten ohne Auftrag. Bei vollständigen Durchsagen beziehen
sich die Farben auf den Stand ihrer Bausteine. Noch unbekannte Spiele erscheinen
unter Durchsagen; daraus werden keine erfundenen Bausteine gezählt.

Die separate aufklappbare **Auftragsliste** zeigt die tatsächlichen
Sprachaufnahmen, Schnitte und Aufbereitung in Abarbeitungsreihenfolge, einschließlich
Quellverknüpfungen und Probehören.

## Live-Planung im eigenen Tab

**Adminmenü → Sprachplanung · live** öffnet den Ablaufplan für das aktuelle
Turnier in einem neuen Browser-Tab. Das Netz orientiert sich an der
[UML-Aktivitätsnotation](https://www.omg.org/spec/UML/ISO/19505-2/PDF): gefüllter
Startkreis, abgerundete Aktionsrechtecke, Entscheidungsrauten und gerichtete
Kontrollflüsse mit `[ja]`/`[nein]` als Bedingungen. Höhere Prioritäten stehen
weiter oben. Nach jeder Aktion folgt eine eigene Entscheidungsraute.
Anmeldevorarbeit und Spielbetrieb bilden alternative Wege abhängig von der
ersten Auslosung. Kleine Rauten führen alternative Wege zusammen, bevor eine
gemeinsame Aktion beginnt; sie bedeuten keine parallele Verarbeitung.

Ein ausführbarer Auftrag führt zur gemeinsamen Bearbeitung rechts im Netz.
Nach seiner Beendigung prüft BTS wieder von oben. Solange die Verarbeitung
läuft, bleibt sie beim selben Auftrag. Sind keine Aufgaben ausführbar, wartet
der Ablauf auf neuen Bedarf oder eine fällige Wiederholung und prüft erneut.
Der Dauerbetrieb hat deshalb keinen abschließenden Endknoten.
Turnierphase, Anzahl der Spiele je Zustand, Bedingungen und
Fortschritt aktualisieren sich alle zwei Sekunden. Gold markiert ausschließlich
den aktuellen oder nächsten Auftrag. Ein laufender Auftrag eines anderen
Turniers wird eigens angezeigt.

Die vereinfachten Balken zeigen **bereit / in der Queue / gesamt**: Grün zählt
fertige Abspielbausteine, Orange fehlende Bausteine mit Auftrag, Grau den noch
nicht beauftragten geplanten Vorrat. „Gesamt“ umfasst diese drei Gruppen. Die
Zahlen und Balken stehen direkt im jeweiligen Schritt. Gemeinsame Teile
zählen einmal beim ersten, vorrangigen Bedarf; Quellaufnahmen werden nicht
zusätzlich zu ihren Ausschnitten gezählt. Optionaler Vorrat der anderen Stimme
steht in einem eigenen Bereich. Die Werte beziehen sich auf den aktuellen Plan
und können sich bei Änderungen am Turnier ändern.

Die Seite liest den vorhandenen Plan und die Warteschlange; sie legt keine
zusätzlichen Sprachaufträge an. Bei Verbindungsverlust werden die aktuellen
Markierungen entfernt und die Verbindung automatisch wiederhergestellt.
Der Ablaufplan lässt sich als eigenständiges SVG mit denselben Verzweigungen
oder über Drucken/PDF exportieren.
Die Bedingungen zeigen, ob schon ausgelost wurde, ob benötigte Ansagen noch offen
sind und ob Vorrat der anderen Stimme möglich ist. Übersprungene Schritte bleiben
beschriftet sichtbar. Laufende und vorbereitete Spiele enthalten ihre möglichen
Tabletbediener; die wartende Tabletliste folgt im Leerlauf nach Aufrufkandidaten
und vor weiteren angesetzten Spielen. Zusätzlicher konkreter Bedarf steht vor
der Vorarbeit im Leerlauf.

Jeder Schritt zeigt seinen Status; die aktuelle Aufnahme steht direkt beim
aktiven Schritt. Ohne aktuelle oder nächste Aufgabe wird kein Arbeitsbereich
markiert. Der Status nennt ausdrücklich, ob alles bereit ist, weitere Arbeit
wartet, Fehler offen sind oder die Verbindung fehlt. Die getrennte Kartenübersicht
entfällt. Auf schmalen Bildschirmen lässt sich das Netz innerhalb der Grafik
seitlich verschieben; die übrige Seite bleibt in Bildschirmbreite.
Die aktuelle Tätigkeit bleibt beim Scrollen am oberen
Rand sichtbar. Die Darstellung folgt vollständig automatisch;
sie ändert weder die Auftragsreihenfolge noch den Sprachbedarf.

## Fehler und Wiederholungen

Fehleranzeigen nennen den betroffenen Schritt, den Grund, die Anzahl der
Fehlversuche und den nächsten Wiederholungs- oder Fallback-Schritt. Die letzten
acht Ereignisse enthalten Zeitpunkte und – soweit vorhanden – Seed und
gemessene Pausen samt Grenzwerten. Drei verworfene Aufnahmekandidaten zählen
als drei Fehlversuche; wiederholte Statusabfragen erhöhen den Zähler nicht.
Verbindungs-/Abruffehler werden getrennt gezählt, ein ausgelasteter Server
(`429/busy`) gilt als normaler Wartezustand.

Die Historie bleibt auch nach erfolgreicher Fertigstellung sichtbar. BTS speichert
sie mit dem persistenten Cache, auch für Aufträge ohne fertige Audiodatei;
es hält höchstens 4096 Bausteinhistorien. Ohne aktivierten Festplattencache gilt
sie für die laufende BTS-Sitzung. Bei älteren Servereinträgen sind teilweise nur
Fehlercode und Versuchsanzahl vorhanden; die Anzeige kennzeichnet fehlende Details.
Der aktualisierte Sprachserver liefert die genaueren Gründe nach seinem Neustart.
Diese Diagnoseänderungen erhalten die bestehenden v2-Audioschlüssel und Aufnahmen.

Schnittfehler werden begrenzt behandelt: Nach einem fehlgeschlagenen Ausschnitt
versucht BTS einmal dieselbe Kontextaufnahme mit einem anderen Seed neu zu erzeugen.
Mehrere Ausschnitte derselben Quelle teilen diese neue Aufnahme. Scheitert auch
dieser Versuch, endet die automatische Verarbeitung mit sichtbarem Fehler.
Bei Teams bleibt danach der bereits abgestimmte letzte Versuch als vollständiger
Einzelname erhalten. Der verbrauchte Wiederherstellungsschritt und der endgültige
Stopp werden im BTS-Cache gespeichert; Seitenneuladen, erneute Vorbereitung und
BTS-Neustarts starten die Schleife nicht neu. Andere Aufträge können weiterlaufen.
Fertige Ausschnitte aus der Ersatzaufnahme bleiben ebenfalls offline verwendbar.
