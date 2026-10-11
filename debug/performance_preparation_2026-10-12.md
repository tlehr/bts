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
