# Automatische Vorbereitung mit wiederkehrenden Spielern

Die gemeinsame Nutzung der Spieler-/Match-Referenzen verkürzt die automatische
Vorbereitung und deren Diagnoseberechnung deutlich. Im isolierten 90-Sekunden-
Vergleich sinkt das Maximum einer Auswahl von 587 auf 63 ms. Die langen Pausen
bei Punktmeldungen gehen zurück; einzelne Wartezeiten beim Spielende und beim
manuellen Aufruf bleiben sichtbar.

Verglichen werden `106107c` und `c61149f` auf `perf/server-responsiveness`.
Die Testwerkzeuge sind separat in `4a2a7a6` gesichert; beide Läufe verwenden
dieselben Werkzeugdateien, denselben Client, dieselben Abhängigkeiten und
dieselben Parameter. Der frühere FIFO-Baseline-Test wird nicht wiederholt.

## Testbedingungen

- 519 synthetische Einzelspiele, 13 Felder, 26 wiederkehrende Spielerpaare.
  Damit entstehen echte Abhängigkeiten zwischen früheren und späteren Spielen.
  Die abschließenden Daten enthalten 52 unterschiedliche Teilnehmer und 26
  unterschiedliche Teilnehmer auf den 13 belegten Feldern.
- Aktive automatische Vorbereitung und automatische Folgeaufrufe nach echten
  Spielenden. Punkte alle 400–800 ms je Tablet, keine zusätzliche Score-Pause,
  deterministischer Client-Seed `519-mixed`, 21 Punkte je Satz.
- Echte dauerhafte NeDB, separater Tablet-/TV-/Admin-Testclient und normale
  WebSocket-Ereignisse. Alle zwei Sekunden ein Sync über den validierten Planner
  mit Nummernänderungen wartender Spiele und eine freie Durchsage.
- Eine gezielte manuelle Aufrufprobe während der ersten Integration.
  Diagnose und Queue-Beobachtung sind in beiden Läufen aktiv.
- Eigene archivierte Serverkopien unter `/tmp`; das laufende Turnier und der
  laufende Server werden nicht verändert. Offiziellen- und Tabletoperator-
  Vergabe bleiben ausgeschaltet.

Wiederholbarer Aufruf gegen einen committeten Stand:

```bash
node debug/mixed_queue_benchmark.js --workload preparation --duration-ms 90000 --point-min-ms 400 --point-max-ms 800
```

Mit `--ref <Commit>` kann ein anderer kompatibler Serverstand geprüft werden.
Ohne `--workload preparation` bleibt die bisherige unabhängige Ordering-Last
erhalten. Ein Lauf ohne beobachtete Vorbereitungsereignisse oder Berechnungen
gilt im neuen Modus als fehlgeschlagen.

## Ergebnisse

| Messwert | Vorher | Referenzen gemeinsam genutzt |
| --- | ---: | ---: |
| Vorbereitungsberechnung Median | 283,4 ms | 32,2 ms |
| Vorbereitungsberechnung p95 | 556,5 ms | 47,6 ms |
| Vorbereitungsberechnung Maximum | 587,3 ms | 63,5 ms |
| Tablet → TV p95 / p99 | 283 / 686 ms | 33 / 70 ms |
| Tablet → TV Maximum | 843 ms | 186 ms |
| TV-Meldungen über 100 ms | 92 | 2 |
| Tablet → Admin p95 / p99 | 212 / 708 ms | 24 / 54 ms |
| Tablet → Admin Maximum | 837 ms | 126 ms |
| Admin-Meldungen über 100 ms | 81 | 1 |
| Event-Loop-Verzögerung Maximum | 605,6 ms | 79,4 ms |
| Freie Durchsage p95 / Maximum | 143,8 / 237,3 ms | 6,6 / 56,9 ms |
| Einzelne manuelle Aufrufprobe | 251,3 ms | 277,2 ms |
| Angekommene Meldungen TV und Admin | jeweils 952/952 | jeweils 959/959 |
| Abgeschlossene Syncs | 46/46 | 46/46 |
| Sync insgesamt p95 / Maximum | 6.377 / 8.465 ms | 753 / 1.093 ms |
| Spielenden / automatische Folgeaufrufe | 5 / 5 | 5 / 5 |
| Beobachtete Vorbereitungsereignisse | 6 | 5 |
| Gemessene Vorbereitungsberechnungen | 27 | 24 |

Beide Läufe werden am Ende vollständig leer. Im letzten Lauf bleibt die Zahl
offener Syncs in jedem Drittel höchstens eins; vorher erreicht sie im letzten
Drittel vorübergehend fünf. Es gibt keine aufgezeichneten Verarbeitungsfehler.
Die TV-Medianlatenz bleibt bei 13 ms, die Admin-Medianlatenz bei 8 ms: der Nutzen
liegt vor allem in weniger langen Unterbrechungen.

## Änderung und Funktionsprüfung

`ParticipantLookup` erfasst offene Spiele je Teamspieler und Ausschlüsse nach
Sonderergebnissen je Disziplin einmal je synchroner Auswahl. Kandidaten,
Frontier-Prüfung und vollständige Diagnoseanzeigen teilen diese Referenzen.
Eine gemeinsame Abfrage aller Hallen verwendet einen gemeinsamen Snapshot.
Der nächste Aufruf baut frische Daten auf; es entsteht kein dauerhafter Cache.
Offizielle und Tabletoperatoren behalten ihre eigenen Verfügbarkeitsregeln.
Lock-Auswahl und Integration werden durch diesen Commit nicht verändert.

Die neuen Regressionen prüfen typisierte Spieler-IDs, gemeinsame Teilnehmer,
Spielende, Reaktivierung, Umnummerierung, Teilnehmerwechsel, Sonderwertungen
einschließlich benannter Diagnosegründe, unvollständige Vorgänger und Freilose.
Ein Test mit 519 Spielen begrenzt wiederholtes Lesen der Teilnehmerlisten auch
bei vollständigen UI-Diagnosen. Ein zusätzlicher Test prüft Änderungen an
hallübergreifenden Abhängigkeiten zwischen zwei Abfragen.

Ein separater Vergleich auf genau demselben abschließenden Snapshot prüft die
gesamte Auswahl einschließlich aller Diagnosen mit `deepStrictEqual`: acht
Paare stimmen vollständig überein. Nach drei Aufwärmpaaren liegt der Median
der fünf Messpaare bei 42,6 ms vorher und 24,1 ms danach. Dies ist eine reine
synchrone Berechnung, kein Ersatz für den Lasttest.

Validierung: 793 Tests der Vollsuite bestanden, anschließend 130 gezielte
Regressionen inklusive des zusätzlichen Hallentests. Die neuen Module und
Tests sind ESLint-sauber. In `match_automation.js` bestehen dieselben 48
Lint-Befunde wie zuvor; Anzahl und Meldungen wurden vor/nach der Änderung
verglichen. `git diff --check` ist sauber.

## Verbleibende konkrete Spitzen

Die manuelle Aufrufprobe wird nicht schneller. Sie wartet 261,7 ms am
`mixed_ordering_apply`; der konkrete Konflikt betrifft
`match:default:btp_default_Singles_13`. Obwohl Spiel 13 von direkten
Nummernänderungen ausgenommen ist, führt eine Spielerbeziehung zu einem
anderen geänderten Spiel zur Sperre. Das ist ein nächster Ansatzpunkt für
eine engere Lock-Planung bei reinen Reihenfolgeänderungen.

Die zwei TV-Meldungen über 100 ms liegen bei 146 und 186 ms. Bei der ersten
beginnt der Server-Trace 75 ms nach dem gemessenen Senden; zusätzlich wartet
das Laden des Matches rund 30 ms auf die DB. Die zweite Meldung bestätigt
ein Spielende. Ihr Trace enthält rund 32 ms Lock-Warten auf die Vorbereitung,
93 ms Finish-Cleanup und 83 ms für die Feldanzeige-Veröffentlichung; diese
Phasen sind teilweise überlappend und dürfen nicht addiert werden. Die
Vorbereitung hält dabei die bisherigen Domain-Locks. Die vollständigen Traces
der auffälligen Meldungen werden im JSON-Bericht mitgesichert.

Ein einzelner Aufruf ist keine belastbare p95-/p99-Messung. Unterschiedliche
Verzögerungen führen trotz identischem Seed zu leicht unterschiedlichem
Turnierfortschritt und unterschiedlichen Zahlen von Vorbereitungsauswahlen.
Die Messung umfasst keine periodischen BTP-TCP/XML-Abrufe, keine echte
Gewinner-/Verlierer-Weiterschaltung im Lastfixture, keine aktive Offiziellen-
oder Tabletoperator-Vergabe, kein Browser-Rendering und keinen hörbaren
Audiostart. Freilos- und Zuweisungsregeln sind zusätzlich durch Regressionen
geprüft. Zwei kurze Läufe sind keine Zusage für beliebige Dauerlast.

Rohdaten vorher: `/tmp/bts-queue-responsiveness-wC85G1`.
Rohdaten nachher: `/tmp/bts-queue-responsiveness-tLQBh2`.
Der begleitende JSON-Bericht enthält die Vergleichsprüfung der Quellen,
Zusammenfassungen, alle Berechnungsdauern und ausgewählte Warte-Traces.

## Beziehungssperren bei reinen Reihenfolgeänderungen

Der nächste Schritt (`00a3e00`) beseitigt den oben beschriebenen Sync-Blocker
für den manuellen Aufruf. Ein zusätzlicher 90-Sekunden-Lauf verwendet den
vorhandenen Lauf `tLQBh2` als Vergleich; Werkzeuge, Parameter, Client,
Abhängigkeiten und Node/CPU stimmen überein. Der vorherige Test wird nicht
wiederholt.

| Messwert | Vorbereitung optimiert | Zusätzlich Beziehungssperren reduziert |
| --- | ---: | ---: |
| Manuelles Aufrufsignal beim Client | 277,2 ms | 13,2 ms |
| Zugehörige Scheduler-Wartezeit | 261,7 ms | 4,4 ms |
| Zugehörige Aufgabenlaufzeit | 38,6 ms | 36,3 ms |
| Tablet → TV p95 / p99 | 33 / 70 ms | 31 / 59 ms |
| Tablet → TV Maximum | 186 ms | 119 ms |
| Tablet → Admin p95 / p99 | 24 / 54 ms | 20 / 47 ms |
| Tablet → Admin Maximum | 126 ms | 107 ms |
| Freie Durchsage p95 / Maximum | 6,6 / 56,9 ms | 2,6 / 5,3 ms |
| Event-Loop-Verzögerung Maximum | 79,4 ms | 60,7 ms |
| Angekommene Meldungen TV und Admin | jeweils 959/959 | jeweils 964/964 |
| Abgeschlossene Syncs | 46/46 | 46/46 |
| Spielenden / automatische Folgeaufrufe | 5 / 5 | 5 / 5 |

Für den manuellen Aufruf wird kein konflikthaltender Sync mehr aufgezeichnet.
Die normale Bearbeitung dauert weiterhin rund 36 ms; der frühere Unterschied
entstand hauptsächlich beim Warten. Das Aufrufereignis wird bereits während
dieser Bearbeitung veröffentlicht. Es wird der Signalempfang gemessen, kein
hörbarer Audiostart.

Die Syncs sind in jedem Drittel höchstens mit einer offenen Integration
vertreten. Ihr p95 liegt bei 770 ms, das Maximum bei 928 ms. Der Lauf endet
mit leeren Queues und ohne aufgezeichneten Verarbeitungsfehler. Das Maximum
wartender Hintergrundvorbereitung beträgt weiterhin rund 250 ms im ersten
Drittel: Sie wartet auf den Auswahl-Lock. Der gezielte Aufruf antwortet
unabhängig von diesem Folgejob.

### Warum die kleinere Sperrmenge zusätzliche Änderungen braucht

Bei einem streng erkannten reinen Ordering-Plan ohne Zuweisungsumfang bleiben
Sync, Auswahl und direkt geänderte Spiele gesperrt. Spieler- und Feldbeziehungen
erweitern dessen Lock-Liste nicht mehr. Aktive Tabletoperator-Vergabe,
zugewiesene Offizielle/Tabletoperatoren, gemischte Änderungen, neue oder
gelöschte Objekte, unbekannte Felder und externe Effekte behalten den bisherigen
konservativen Umfang. Freilose werden weiterhin weitergeschoben.

Ein manueller Aufruf kann den Spielerstatus in späteren, gerade umnummerierten
Spielen aktualisieren. Diese Helfer dürfen deshalb nicht ihr komplettes altes
Setup zurückschreiben. Die kleine Klasse `match_updates/setup_changes.js`
erfasst nur tatsächlich geänderte Setup-Felder. Spieler-/Tabletstatus und
Pausen-Reset erhalten damit gleichzeitig geschriebene Spielnummern. Die
Statusbenachrichtigungen verwenden das tatsächlich gespeicherte Setup;
Finish-Cleanup behält seine Teilnehmer-Patches und meldet ebenfalls den
aktuellen Datensatz.

Der Ordering-Planner liest vor Veröffentlichung einmal die aktuellen
Match-Referenzen in der Reihenfolge des DB-Executors. Bei einem Fehler nimmt
er nur seine eigenen geänderten Felder zurück. Ein zwischenzeitlich
abgeschlossener Aufruf oder Finish-Cleanup wird damit nicht rückgängig gemacht.
Im Lastlauf sind 42 solche zusätzlichen Lesephasen aufgezeichnet; sie dauern
höchstens 1 ms. Die bestehende Validierung von Vorbereitung, Spielende,
Check-in und anderen Abhängigkeiten vor dem Commit bleibt erhalten.

Vier gezielt verzögerte Regressionen prüfen Fortschritt eines echten
verwandten Aufrufs, einen Statuswriter mit altem Setup, Rollback nach einem
späteren Schreibfehler und Benachrichtigungen beim Finish. Alle vier scheitern
am vorherigen Stand. Sie scheitern auch, wenn dort ausschließlich die kleinere
Lock-Liste eingesetzt wird: alte Nummern werden zurückgeschrieben, Rollback
stellt alten Spielerstatus wieder her und Benachrichtigungen enthalten alte
Setups. Die vollständige Änderung besteht alle vier Fälle.

Die Vollsuite besteht mit **798 Tests**; zuvor bestehen 149 gezielte Tests.
Ein alter Test-Datastore konnte bisher nur `$set` auf oberster Ebene anwenden;
er verwendet jetzt NeDBs echten Modifier auch für Feldpfade. Kleine geänderte
Module und Tests sind ESLint-sauber. In `admin.js` und `match_utils.js` bestehen
dieselben 232 bzw. 82 Lint-Befunde wie zuvor; es kommen keine hinzu.
`git diff --check` ist sauber.

### Verbleibende Spitze und Messgrenzen

Eine Meldung erreicht TV nach 119 ms und Admin nach 107 ms. Sie bestätigt ein
Spielende. Der Trace enthält 81,5 ms Lock-Warten, 38,5 ms Finish-Cleanup und
14,8 ms Kontextlesen. Diese teilweise überlappenden Phasen sind nicht zu
addieren. Der konkrete Blocker ist hier ein weiterer `mixed_ordering_apply`
mit 236 Änderungen und breitem Zuweisungsumfang; die Konflikte betreffen
`auto-call`, `preparation`, `tabletoperators` und `umpires`. Dieser Plan fällt
nicht unter die engere Sperrmenge. Seine Einstufung und seine tatsächlich
betroffenen Schreibziele sind ein eigener nächster Optimierungspunkt. Die
vollständigen Traces von Bestätigung und blockierendem Sync sind im JSON-Bericht
gesichert.

Eine einzelne Aufrufprobe ist weiterhin keine p95-/p99-Aussage für alle
Aufrufe. Die gezielt gehaltenen Tests belegen zusätzlich, dass ein Aufruf
bereits während der Integration fortschreiten kann und seine Daten erhalten
bleiben. Die übrigen Grenzen des Lasttests gelten weiterhin, insbesondere
fehlende aktive Offiziellen-/Tabletoperator-Vergabe und begrenzte Dauer.

Neuer Lauf: `/tmp/bts-queue-responsiveness-N4Fa53`.
Kontrollprüfungen: `/tmp/bts-related-regression-a61q98a0`.
Der JSON-Bericht ergänzt die Historie unter `related_call_lock_optimization`;
alle vorherigen Ergebnisse bleiben erhalten.

## Unveränderte Spielmeldungen als Ursache der breiten Einstufung

`85f1b57` beseitigt den zuvor beschriebenen breiten Umnummerierungsplan. Der
Plan verändert ausschließlich Spielnummern, enthält aber zusätzlich
`match_edit`-Meldungen für bereits korrekt nummerierte Spiele. Bisher musste
jede Meldung ein tatsächlich geschriebenes Spiel nennen. Andernfalls wurde
der gesamte Plan mit Zuweisungs-Locks versehen.

Ein separater Diagnoselauf bestätigt einen solchen Fall mit 236 tatsächlichen
Änderungen und 255 Meldungen. Für die 19 zusätzlichen Meldungen zeigen die
protokollierten Beispiele vorhandene Spiele, deren vollständiger Meldungsinhalt
mit diesem Snapshot übereinstimmt.
Keines der 236 Write-Ziele verletzt die bisherigen Ordering-Kriterien.
Bei echten automatischen Folgeaufrufen werden dagegen Court-, Teilnehmer-
und Statusänderungen gefunden; diese Pläne behalten ihre Zuweisungs-Locks.

Die Klasse `ordering_notifications.js` prüft diese Lesemeldungen einmal je
Plan. Zulässig sind ein vollständiges unverändertes Match, ein entsprechender
Wrapper oder ausschließlich dessen kanonische `match__id`. Der Snapshot-
Index wird erst bei Bedarf aufgebaut. Unbekannte Ziele, abweichende Inhalte,
zusätzliche Wrapper-Felder, Sammellisten und weitere Effekte bleiben
konservativ. Die Meldungen werden weiterhin veröffentlicht und nutzen den
bereits abgesicherten aktuellen Match-Snapshot nach dem Commit.

Die Trace-Phase `incremental_plan` nennt jetzt `allocation_scope` und
`ordering_unchanged_notifications` direkt. Es werden keine Spielerdaten oder
Meldungspayloads in diese Diagnose übernommen. Normaler Serverbetrieb erzeugt
dadurch keine zusätzlichen Konsolenmeldungen.

### Gegenlauf ohne zusätzliche Instrumentierung

Ein weiterer normaler 90-Sekunden-Lauf verwendet den vorhandenen Lauf
`N4Fa53` als Vergleich. Die Testwerkzeuge, Parameter, Client, Abhängigkeiten
und Node/CPU stimmen überein. Es wird kein vorheriger Standardlauf wiederholt.

| Messwert | Beziehungssperren reduziert | Zusätzlich Lesemeldungen anerkannt |
| --- | ---: | ---: |
| Manuelles Aufrufsignal | 13,2 ms | 11,3 ms |
| Tablet → TV p95 / p99 | 31 / 59 ms | 30 / 59 ms |
| Tablet → TV Maximum | 119 ms | 109 ms |
| Tablet → Admin p95 / p99 | 20 / 47 ms | 19 / 41 ms |
| Tablet → Admin Maximum | 107 ms | 73 ms |
| Freie Durchsage p95 / Maximum | 2,6 / 5,3 ms | 4,5 / 8,0 ms |
| Sync insgesamt p95 / Maximum | 770 / 928 ms | 576 / 960 ms |
| Event-Loop-Verzögerung Maximum | 60,7 ms | 81,0 ms |
| Angekommene Meldungen TV und Admin | jeweils 964/964 | jeweils 960/960 |
| Abgeschlossene Syncs | 46/46 | 46/46 |
| Spielenden / automatische Folgeaufrufe | 5 / 5 | 5 / 5 |

Alle 50 aufgezeichneten Klassifizierungen der `mixed_ordering_apply`-Pläne
(einschließlich Neuplanungen) sind `ordering_only`. Drei davon erkennen
19, 19 bzw. 18 unveränderte Meldungen an und behalten die kleine Sperrmenge.
Eine generelle Verbesserung jedes Maximums wird nicht behauptet: der
Event-Loop-Wert und die Durchsage-Maximalzeit sind in diesem Lauf höher.
Die Zahl offener Syncs bleibt in jedem Drittel höchstens eins; der Lauf endet
mit leeren Queues und ohne aufgezeichneten Verarbeitungsfehler.

Vier neue Regressionen prüfen erlaubte Payload-Formen, abweichende/fehlende
Ziele, konservative Zuweisungs-, Check-in-, Ergebnis- und Freilosregeln sowie
einen echten Tablet-Spielabschluss während einer gehaltenen Umnummerierung.
Nach dem Abschluss enthält auch die spätere Lesemeldung den gespeicherten
Endstatus. Die positive Klassifizierung und der Spielabschluss scheitern am
vorherigen Stand; der Abschluss wartet dort auf den breiten Plan. Die
Vollsuite besteht mit **802 Tests**, danach 22 gezielte Regressionen. Alle
geänderten JS-Dateien und Tests sind ESLint-sauber, `git diff --check` ebenfalls.

### Diagnoseversuche und verbleibende TV-Spitze

Die ersten beiden verkürzten 30-Sekunden-Diagnoseversuche erreichen keine
Spielenden oder aktive Vorbereitung und werden deshalb vom Runner abgelehnt.
Sie werden nicht für Performance-Aussagen verwendet. Der anschließende
90-Sekunden-Diagnoselauf verwendet einen nur in eigenen Testprozessen aktiven
Preload, der Feldpfade und Meldungsgründe erfasst. Er wiederholt jedoch die
Ordering-Prüfung pro Effekt und verursacht erhebliche zusätzliche Rechenarbeit.
Seine Latenzen und Empfangslücken sind daher ebenfalls kein Performance-
Vergleich. Die Klassifizierungsbefunde und die Beobachterquelle sind im JSON
archiviert; der abschließende Standardlauf verwendet diesen Preload nicht.

Die einzige TV-Meldung über 100 ms im neuen Standardlauf liegt bei 109 ms.
Sie betrifft einen gewöhnlichen Punkt; Admin empfängt ihn nach 26 ms. Der
Serverhandler läuft 18,3 ms. Die asynchrone Feldanzeige-Veröffentlichung
enthält eine Phase von 73,1 ms; ein Court-Lesen wartet rund 30 ms auf den
DB-Executor und läuft anschließend rund 30 ms einschließlich asynchroner
Fortsetzung. Diese Zeiten sind teilweise überlappend. Der vollständige Trace
bleibt für eine mögliche weitere Prüfung des TV-Lesepfads erhalten.

Neuer Standardlauf: `/tmp/bts-queue-responsiveness-KOKqqY`.
Diagnoselauf: `/tmp/bts-queue-responsiveness-46gKEV`.
Kontrollprüfungen: `/tmp/bts-notification-regression-qzdxutd6`.
Der JSON-Bericht ergänzt `unchanged_notification_lock_optimization` und erhält
alle vorherigen Ergebnisse. Die bisherigen Grenzen bezüglich Dauerlast,
echtem BTP-Abruf, Browser-Rendering, hörbarem Audiostart und aktiver
Offiziellen-/Tabletoperator-Vergabe gelten weiterhin.

## Gezielte Objekt-Reads für die TV-Punktanzeige

Commit `819e144` ersetzt im inkrementellen V2-Punkt-Fanout die normalen
Court-, Match- und Turnierabfragen durch gezielte Reads der kanonischen
Objekte. Jeder Read bleibt im Executor seiner Collection: vorherige Writes
müssen einschließlich Persistenz abgeschlossen sein. Der aktuelle Court
bestimmt das zu lesende Match; Daten aus dem ursprünglichen Punkt-Request
werden nicht als möglicherweise veralteter Anzeige-Snapshot wiederverwendet.
Die Reads liefern getrennte Kopien. Einzel- und Mehrfeldanzeige teilen weiterhin
einen Court-Kontext pro Fanout; blockierte Tablet-/Vollzustands-Refreshes
halten inkrementelle TV-Meldungen weiterhin nicht auf.

`tournament_model/display_reads.js` kapselt die Reads in einer kleinen Datei.
Die unveränderte Auswahl der Präsentationsfelder liegt gemeinsam in
`panel_tournament_projection.js`; Registrierungen werden nicht kopiert.
Unvollständige oder simulierte Datastores behalten die bisherigen Async-/Callback-Reads.
Ein TTL-Index wird erst beim tatsächlichen Start des Reads geprüft. Falls
vorhanden, läuft NeDBs normaler Cursor einschließlich Ablauf/Löschung im
gleichen Executor-Slot. Diese potenziell schreibende Aufgabe ist konservativ
kein zertifizierter Nur-Lese-Task und nutzt keinen Kompaktierungs-Bypass.
Weitere Locks, Threads oder Prioritätsregeln werden nicht eingeführt.
Initialisierung/Vollzustand und die Suche nach kürzlich beendeten Spielen
behalten ihre bisherigen Pfade.

Sieben neue Regressionen prüfen gezielte Kopien/Präsentationsfelder ohne
Registrierungs- oder Match-Scan, Persistenz-/Write-Reihenfolge, fehlende,
verschobene und gelöschte Objekte, nach Enqueue hinzugefügte TTL-Indizes,
aktuelle Feldzuweisung im echten Fanout, Einzel-/Mehrfeldpunkte ohne normale
DB-Cursor sowie Async-/Callback-Fallbacks. Die vollständige Suite besteht mit
**809 Tests**. Neue Module, Modell-Anbindung und geänderte Tests sind
ESLint-sauber. Die 27 bereits vorhandenen Befunde in `bupws_v2.js` bleiben
unverändert; es wird keine Lint-saubere Gesamtdatei behauptet.

### Vergleich unter derselben Vorbereitungslast

Ein neuer normaler 90-Sekunden-Lauf verwendet `KOKqqY` als vorhandene Referenz.
Parameter, alle acht Testwerkzeug-Hashes, Client-Commit/-Quelle,
Abhängigkeits-Lock, Node und CPU stimmen überein. Der Server läuft aus dem
unveränderlichen Archiv des geprüften Commits. Kein Live-Turnier wird
verändert; der alte Lauf wird nicht wiederholt.

| Messwert | Normale Anzeige-Reads | Gezielte Anzeige-Reads |
| --- | ---: | ---: |
| Tablet → TV Mittel / p95 / p99 | 14,1 / 30 / 59 ms | 12,8 / 27 / 56 ms |
| Tablet → TV Maximum / über 100 ms | 109 ms / 1 | 74 ms / 0 |
| Tablet → Admin p95 / p99 / Maximum | 19 / 41 / 73 ms | 21 / 49 / 69 ms |
| Court-Fanout-Phase p99 / Maximum | 18,5 / 73,6 ms | 11,7 / 41,3 ms |
| Gruppierung/Turnier-Read p99 / Maximum | 9,9 / 43,6 ms | 5,4 / 8,5 ms |
| Primärer Score-Lock-Wait p99 / Maximum | 3,4 / 12,9 ms | 3,5 / 9,1 ms |
| Score-Handler Median / p95 | 6,6 / 17,6 ms | 8,9 / 22,2 ms |
| Manuelles Aufrufsignal | 11,3 ms | 13,9 ms |
| Freie Durchsage p95 / Maximum | 4,5 / 8,0 ms | 4,1 / 5,4 ms |
| Sync insgesamt p95 / Maximum | 576 / 960 ms | 634 / 1310 ms |
| Event-Loop-Verzögerung Maximum | 81,0 ms | 96,7 ms |
| Empfangene Meldungen TV und Admin | jeweils 960/960 | jeweils 957/957 |
| Syncs / Spielenden / automatische Folgeaufrufe | 46 / 5 / 5 | 46 / 5 / 5 |

Die eigentlichen Court-/Match-Objekt-Reads liegen im neuen Lauf jeweils
höchstens bei 0,4 ms, der Turnier-Read höchstens bei 0,6 ms. Die einzelnen
Read-Verteilungen im JSON beziehen sich auf normale Punkt-Roots; die fünf
Spielabschluss-Roots fassen DB-Spans zusammen und erlauben hierfür keine
vollständige Einzelverteilung. Alte generische `findOne`-Namen umfassen zudem
weitere, durch den gleichen Vorgang geerbte Reads. Die vollständigen
Fanout-Phasen und die Client-Empfangsmessungen sind deshalb der maßgebliche
Vergleich. Asynchrone DB-Zeiten sind keine synchronen CPU-Zeiten und dürfen
nicht zu überlappenden Handler-/Phasenzeiten addiert werden.

Alle 49 aufgezeichneten Umnummerierungs-Klassifizierungen sind weiterhin
`ordering_only`. Alle Syncs und Anfragen werden beantwortet, es gibt keine
aufgezeichneten Verarbeitungsfehler. Je Laufdrittel bleibt höchstens ein Sync
offen; der Lauf endet mit geleerten Queues. Die finale Fixture enthält erneut
519 Spiele, 52 verschiedene Teilnehmer und 13 aktive Felder mit 26
verschiedenen Spielern. Das Serverlog bleibt leer.

Die kürzere TV-Veröffentlichung ist im Trace nachvollziehbar. Die langsamste
TV-Meldung des neuen Laufs benötigt 74 ms, Admin 69 ms. Zwischen Client-Senden
und Handler-Start liegen hier 44 ms; das Kontextladen dauert 19,5 ms. Der
Handler wartet nur 2,5 ms auf seine Locks ohne gemeldeten Blockierer. Seine
Court-Fanout-Phase beträgt anschließend 3,6 ms. Die größte Fanout-Phase des
Laufs liegt bei einem anderen Punkt bei 41,3 ms (TV 56 ms, Admin 9 ms): der
Court-Read beginnt nach 35,4 ms Queue-Wartezeit, ohne beim Enqueue erfassten
Blockierer; der Read selbst dauert 0,2 ms. Eine genaue CPU-/Dispatch-Ursache
dieser verbleibenden Verzögerungen wird nicht behauptet.

Admin-p99, Handler-Median, Event-Loop-Maximum und Sync-Maximum sind in diesem
einzelnen Gegenlauf höher. Es wird weder eine Verbesserung aller Teilpfade
noch eine kausale Regression dieser Werte aus diesem kurzen Vergleich
abgeleitet. Die Serverlast und der konkrete Turnierfortschritt variieren trotz
gleicher Fixture/Parameter geringfügig. Das Ergebnis belegt den gezielten
TV-Pfad; Dauerlast, periodischer BTP-Abruf, aktive Offiziellenvergabe,
Browser-Rendering und hörbarer Audiostart bleiben separate Messziele.

Neuer Standardlauf: `/tmp/bts-queue-responsiveness-4szjcF`.
Validierung: `/tmp/bts-display-reads-full-suite.log`.
Der JSON-Bericht ergänzt `display_context_read_optimization` und erhält alle
vorherigen Ergebnisse inklusive ungünstiger Werte und Diagnosegrenzen.

## Schlanke automatische Vorbereitung als Standard

Die verbliebenen Verzögerungen vor dem Score-Handler wurden mit einem
CPU-Sampling-Profil im eigenen archivierten Testserver untersucht. Zwei
langsame Punkte des Diagnoselaufs warten zwischen Client-Senden und Handler-
Start 68 bzw. 66 ms. In diesen Fenstern entfallen ungefähr 52,7 bzw. 48,5 ms
Sampling-Zeit auf `calculate_location_preparation_selection`. Ein großer
Anteil liegt in der Schleife für vollständige Match-/UI-Diagnosen. Diese
Berechnung läuft synchron auf dem Hauptthread, während der nächste
WebSocket-Punkt verarbeitet werden müsste. Die Sampling-Fenster, Stack-
Summen, monotone/Wandzeit-Zuordnung und Beobachterquelle sind im JSON
archiviert. Inklusive Stack-Zeiten überlappen und werden nicht addiert.
Der Profil-Lauf ist ein Ursachenbeleg, kein Performance-Vergleich.

Die bereits vorhandene schlanke automatische Auswahl war bisher standardmäßig
ausgeschaltet. Commit `ccbf6c2` aktiviert ausschließlich
`preparation_candidates` als Standard. Damit nutzen auch `make dev` und
`make run` ohne spezielle Performance-Umgebungsvariable diesen Pfad.
`BTS_PREPARATION_CANDIDATES_LIGHT=0` erhält den alten Pfad für gezielte
Vergleiche. Kein anderer Feature-Standard, keine Locks, Writer oder Threads
werden geändert.

Automatische Aufrufe benötigen die echten Kandidaten und Zulassungsregeln,
aber keine vollständigen Diagnoseanzeigen für alle Spiele. Die schlanke
Auswahl erhält diese Kandidaten und berechnet bei einer leeren Auswahl die
für eine selbstblockierende wartende Tablet-Offiziellen-Zuweisung benötigte
Frontier-Diagnose. Explizite Admin-Abfragen berechnen weiterhin alle
Match-, Feld- und Aufrufdiagnosen. Die bestehende Freilosweitergabe bleibt
unverändert.

Eine neue Integration prüft beide Standardsituationen (Variable fehlt und
expliziter alter Override) mit echten Vorbereitungsaufrufen und anschließender
echter Admin-Abfrage. Beide wählen dasselbe Match und speichern denselben
Aufrufzeitpunkt; die Admin-Antwort enthält weiterhin vollständige Diagnosen.
93 gezielte bestehende Regressionen einschließlich Sync/Freilosweitergabe,
sechs Tests inklusive dieser Integration und die vollständige Suite mit
**810 Tests** bestehen. Die geänderte Profil-Datei und der Test sind
ESLint-sauber, `git diff --check` ebenfalls.

### Vergleich mit dem vorhandenen Standardlauf

Ein neuer unveränderter 90-Sekunden-Runner verwendet `4szjcF` als Referenz.
Alle sieben Herkunftsprüfungen bestehen: Parameter, acht Testwerkzeug-Hashes,
Client-Commit/-Quelle, Dependency-Lock, Node und CPU sind identisch.
Die tatsächlichen Server-Feature-Profile unterscheiden sich ausschließlich
in `preparation_candidates: false → true`; innerhalb jedes Laufs bleibt das
Profil stabil. Der CPU-Profiler ist beim Vergleich deaktiviert.

| Messwert | Vollständige Vorbereitung | Schlanke automatische Auswahl |
| --- | ---: | ---: |
| Synchrone Vorbereitungsberechnung Median / p95 / Maximum | 30,1 / 45,2 / 70,2 ms | 5,5 / 10,7 / 13,9 ms |
| Tablet → TV p95 / p99 / Maximum | 27 / 56 / 74 ms | 25 / 46 / 90 ms |
| Tablet → Admin p95 / p99 / Maximum | 21 / 49 / 69 ms | 20 / 32 / 67 ms |
| Senden bis Handler-Start p99 | 31 ms | 18 ms |
| Kontextladen p99 / Maximum | 11,5 / 32,4 ms | 10,6 / 44,3 ms |
| Primärer Score-Lock-Wait p99 / Maximum | 3,5 / 9,1 ms | 2,6 / 4,1 ms |
| Manuelles Aufrufsignal | 13,9 ms | 14,6 ms |
| Freie Durchsage p95 / Maximum | 4,1 / 5,4 ms | 13,1 / 76,8 ms |
| Sync insgesamt p95 / Maximum | 634 / 1310 ms | 780 / 964 ms |
| Event-Loop-Verzögerung Maximum | 96,7 ms | 70,2 ms |
| Empfangene Meldungen TV und Admin | jeweils 957/957 | jeweils 965/965 |
| Syncs / Spielenden / automatische Folgeaufrufe | 46 / 5 / 5 | 46 / 5 / 5 |

Die Reduktion der konkreten Vorbereitungsberechnung und die kürzeren
Empfangs-p99 sind sichtbar. Nicht jedes Maximum wird kleiner: TV-Maximum,
Kontext-Maximum, Durchsagewerte und Sync-p95 sind höher und bleiben im
Bericht erhalten. Es gibt keine aufgezeichneten Verarbeitungsfehler und
keinen wachsenden oder bleibenden Rückstau. Je Drittel bleibt höchstens ein
Sync offen; alle Queues werden geleert. Alle 52 aufgezeichneten
Umnummerierungs-Klassifizierungen bleiben `ordering_only`. Die finale
Fixture enthält unverändert 519 Spiele, 52 verschiedene Teilnehmer und
13 aktive Felder mit 26 verschiedenen Spielern. Das Serverlog bleibt leer.

### Durchsage-Spitzen: Server-Übergabe und Simulator trennen

Die 76,8-ms-Durchsage im Standardlauf durchläuft laut Handler keine
Ressourcen-Queue. Ihr Zeitfenster enthält regelmäßige Server-Abtastungen im
20-ms-Abstand; daraus ergibt sich kein Beleg für eine entsprechend lange
Server-Blockade. Der normale Runner erfasst jedoch keine getrennten
Server-Empfangs-/Handoff-Zeitstempel. Ihre exakte Ursache kann deshalb nicht
rückwirkend behauptet werden.

Ein zusätzlicher Diagnoselauf beobachtet diese Grenzen im eigenen Testserver
und profiliert den separaten Simulatorprozess. Bei seiner langsamsten
Durchsage liegen 8,87 ms zwischen Senden und Server-Handler. Der Server
übergibt das Signal nach weiteren **0,098 ms** an `ws.send`; der komplette
Handler dauert 0,330 ms. Anschließend liegen **76,92 ms** bis zum Empfangs-
Callback. In diesem Fenster zeigen die CPU-Samples ungefähr 51,2 ms in
`bts-testclient/vendor/bup/js/utils.js:deep_copy` und 16,4 ms im Nachrichten-
Handler des Simulators. Eine zweite langsame Durchsage zeigt denselben
Befund: Handler-Start bis Handoff 0,081 ms, danach 64,47 ms bis Empfang,
mit ungefähr 45,8 ms in `deep_copy`.

Über alle 46 diagnostischen Durchsagen liegt die Server-Handoff-Phase im
Median bei 0,089 ms, maximal bei 0,266 ms; der komplette Handler dauert
höchstens 1,25 ms. Die beobachtete Outbox hat danach weder wartende noch
aktive Encoder, der gemeldete Transportpuffer liegt bei null. Handoff
bedeutet Übergabe an WebSocket, nicht garantiertes Schreiben auf die Leitung.
Die langen Diagnosefälle belegen vor allem Arbeit im Simulator nach diesem
Handoff. Dessen Probe-Verbindung und sämtliche simulierten Geräte teilen
derzeit einen Node-Hauptthread. Die gemessene Empfangslatenz enthält somit
auch dessen Kopier-/Nachrichtenarbeit.

Dieser zweite Diagnoselauf hat eigene Profiler-/Beobachterkosten und ist
ebenfalls kein weiterer Performance-Vergleich. Er identifiziert die neu
beobachteten Fälle, nicht exakt die frühere 76,8-ms-Meldung. Der Client wird
in diesem Schritt nicht optimiert. Für zuverlässige weitere Server-Prüfungen
sollte eine unabhängige Signal-Empfangsprobe beziehungsweise dauerhaft
getrennte Server-Handoff-/Empfangszeiten folgen. Verbliebene breite
Hintergrund-Match-Reads und die vollständige Admin-Diagnoseberechnung sind
weitere konkrete Prüfstellen. Dauerlast, echter periodischer BTP-Abruf,
aktive Offiziellenvergabe, Browser-Rendering und hörbarer Audiostart bleiben
außerhalb dieser Abnahme.

Standardlauf: `/tmp/bts-queue-responsiveness-IlUBgP`.
Server-CPU-Diagnose: `/tmp/bts-queue-responsiveness-5x9NmG`.
Signal-/Simulator-Diagnose: `/tmp/bts-queue-responsiveness-40KDHB`.
Vollsuite: `/tmp/bts-light-preparation-full-suite.log`.
Der JSON-Bericht ergänzt `lean_automatic_preparation_default` und erhält
die vollständige bisherige Historie. Die Diagnosequellen, Profil-Hashes,
Zeitgrenzen und ausgewählten CPU-Fenster sind darin enthalten; die rohen
CPU-Profile liegen in den genannten temporären Laufverzeichnissen.
