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
