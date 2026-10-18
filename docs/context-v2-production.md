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

**Adminmenü → Sprachplanung · live** öffnet das vereinfachte
Zustandsübergangsdiagramm für das aktuelle Turnier in einem neuen Browser-Tab.
Es orientiert sich an der [UML-Zustandsnotation](https://www.omg.org/spec/UML/ISO/19505-2/PDF):
gefüllter Startkreis, abgerundete Zustände mit einem eigenen Bereich für die
interne Tätigkeit (do / …), Entscheidungsrauten und Übergänge mit [ja]/[nein].
Kleine gefüllte Kreise führen alternative Wege zusammen. Höhere Prioritäten
stehen weiter oben; Anmeldung und Spielbetrieb bilden getrennte Wege.

Blau markiert einen zusammenhängenden Auswahlweg vom Start durch die
Entscheidungen bis zum aktuellen Zustand. Ein goldener Rahmen markiert diesen Zustand
oder, wenn noch kein Auftrag läuft, den nächsten vorgemerkten Bereich. Der
Auftragstext und das Erzeugen, Ausschneiden oder Aufbereiten gehören in den
Zustand; eine zusätzliche Bearbeitungs- oder Rücksprungschleife entfällt.
Eigene Zustände zeigen „Alles bereit“, Warten, ausgeschaltete Generierung oder
einen unbekannten Planungsstand. Bei Verbindungsverlust ersetzt der Weg zum
unbekannten Planungsstand den bisherigen Auswahlweg.

Während der Hintergrund-Neuberechnung bleibt ein bereits bekannter Plan
sichtbar. Die Statusantwort meldet die Neuberechnung separat als `updating`;
der tatsächliche Arbeitszustand und die Auftragsauswahl bleiben verfügbar.
Die Browseransicht verarbeitet auch die bisherigen Antworten eines noch
laufenden BTS-Prozesses entsprechend, wenn dessen Turnierphase bereits bekannt
ist. Ohne vollständigen Plan beim ersten Laden oder nach einem
Verbindungsverlust bleibt „Planungsstand unbekannt“ erhalten. Unveränderte
Markierungen, SVG-Pfeile und Pfeilspitzen werden wiederverwendet.

Hellgrüne Zustandsflächen kennzeichnen Bereiche, deren sämtliche aktuell für
dieses Turnier geplanten Teile fertig sind. Bereiche ohne geplante Aufgaben
oder mit offenen, fehlgeschlagenen beziehungsweise laufenden Aufträgen erhalten
diese Fläche nicht. Neuer Bedarf entfernt die Fertigmarkierung wieder;
Fortschritt und Bereitschaft werden weiterhin live aktualisiert. Die Farben
erscheinen auch im SVG-Export.

Der Auswahlweg ergibt sich aus der aktuellen Turnierphase und der vom Scheduler
gemeldeten Auftragsauswahl. Er ist keine gespeicherte Ablaufhistorie.
Die aufklappbare Erklärung nennt die durchlaufenen Entscheidungen mit ihren
Antworten und Begründungen. Bereits fertige oder ungeplante Bereiche werden
entsprechend benannt. Wenn während eines laufenden Auftrags höherer Bedarf
hinzukommt, wird dieser nicht fälschlich als erledigt dargestellt: Neue
Prioritäten greifen nach dem laufenden Auftrag. Eine bereits laufende
Anmeldevorarbeit bleibt auch nach der ersten Auslosung als aktueller Zustand
sichtbar, bis sie beendet ist.

Turnierphase, Anzahl der Spiele je Zustand, Bedingungen und Fortschritt
aktualisieren sich alle zwei Sekunden. Ein laufender Auftrag eines anderen
Turniers wird eigens angezeigt; im vorgemerkten Zustand steht dann das Warten
auf einen freien Sprachserver als interne Tätigkeit.

Die vereinfachten Balken zeigen **bereit / in der Queue / gesamt**: Grün zählt
fertige Abspielbausteine, Orange fehlende Bausteine mit Auftrag, Grau den noch
nicht beauftragten geplanten Vorrat. „Gesamt“ umfasst diese drei Gruppen. Die
Zahlen und Balken stehen direkt im jeweiligen Zustand. Gemeinsame Teile
zählen einmal beim ersten, vorrangigen Bedarf; Quellaufnahmen werden nicht
zusätzlich zu ihren Ausschnitten gezählt. Optionaler Vorrat der anderen Stimme
steht in einem eigenen Zustand. Die Werte beziehen sich auf den aktuellen Plan
und können sich bei Änderungen am Turnier ändern.

Die Seite liest den vorhandenen Plan und die Warteschlange; sie legt keine
zusätzlichen Sprachaufträge an. Nach einem Abbruch wird die Verbindung
automatisch wiederhergestellt. Das Zustandsdiagramm lässt sich als
eigenständiges SVG mit markiertem Auswahlweg oder über Drucken/PDF exportieren.
Übersprungene Bereiche bleiben beschriftet sichtbar. Laufende und vorbereitete
Spiele enthalten ihre möglichen Tabletbediener; die wartende Tabletliste folgt
im Leerlauf nach Aufrufkandidaten und vor weiteren angesetzten Spielen.
Zusätzlicher konkreter Bedarf steht vor der Vorarbeit im Leerlauf.

Auf schmalen Bildschirmen lässt sich das Netz innerhalb der Grafik seitlich
verschieben; die übrige Seite bleibt in Bildschirmbreite. Die aktuelle
Tätigkeit bleibt beim Scrollen am oberen Rand sichtbar. Die Darstellung folgt
vollständig automatisch; sie ändert weder die Auftragsreihenfolge noch den
Sprachbedarf.

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
