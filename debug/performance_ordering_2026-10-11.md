# Spielaufrufe während Nummernänderungen

Die engere Lock-Auswahl reduziert in diesem kontrollierten Fall die
Empfangslatenz eines unbeteiligten Spielaufrufs von 295,2 auf 22,1 ms.
Die Aufgabe wartet dabei 4,0 statt 266,0 ms im Scheduler. Der Server behält
die betroffenen Match-Locks und einen eigenen Lock für die Kandidatenauswahl.

Verglichen wurden `1d2c63d08db3b792cf3db4ba0de2dbdb813e007e` und
`8107b82ac85198ba1c946175b62cb157a6125972`, jeweils drei Wiederholungen
mit wechselnder Reihenfolge. Synthetisches Turnier: 519 unabhängige Spiele,
1.038 eingecheckte Spieler, 13 Felder; 518 Spielnummern ändern sich.
Spiel 1 wird tatsächlich über WebSocket aufgerufen, beim ersten laufenden
Schreibvorgang an der Match-DB. Empfang in einem separaten Prozess vor JSON-Parse.

| Messung, Median aus drei Fällen | Vorher | Nachher |
| --- | ---: | ---: |
| Spielaufruf → Empfang beim Client | 295,2 ms | 22,1 ms |
| Warten des Spielaufrufs im Scheduler | 266,0 ms | 4,0 ms |
| Freie Durchsage → Empfang beim Client | 3,5 ms | 3,2 ms |
| Gesamter Root-Sync | 818,5 ms | 941,1 ms |

In allen sechs Fällen wurden beide Events und beide Antworten empfangen,
alle 518 Änderungen geprüft und sämtliche beobachteten Scheduler-/DB-Aufgaben
abgeschlossen. Anfrage und Queue-Eintritt lagen jeweils vor dem Sync-Ende.
Vorher kam das Aufruf-Event erst nach dem Sync an, danach in allen drei Fällen
schon während des Syncs. Die bisherigen Blockierer waren die gemeinsamen
`preparation`, `auto-call`, `tabletoperators` und `umpires`-Locks; danach wurde
für den Aufruf kein Lock-Konflikt beobachtet.

Die Gesamtdauer des Syncs ist in dieser Messung länger. Belegt ist die bessere
Reaktionszeit für parallele Interaktionen; der Sync selbst wird durch diese
Änderung nicht insgesamt schneller. Drei Wiederholungen ergeben keine
belastbare Langzeit-p95 oder allgemeine Kapazitätsgrenze.

Die engere Auswahl greift ausschließlich bei erkannten Nummern- und
Reihenfolgeänderungen. Profil-/Zustands-/Ergebnisänderungen, Freilos-Effekte,
aktive Tabletoperator-Zuweisung oder bereits zugewiesene Offizielle verwenden
weiterhin die umfangreichere Sperre. Die synthetischen Spiele haben voneinander
unabhängige Teilnehmer; gemeinsam beteiligte Spieler bleiben geschützt.
Eine automatische Kandidatenauswahl wartet auf den Auswahl-Lock und validiert
den Plan vor dem Schreiben erneut. Die Vorbereitung nach einem manuellen
Spielaufruf wird als eigene Folgeaufgabe eingereiht.

Validierung: vollständige BTS-Suite **764 Tests**, gezielte Paralleltests mit
echtem Admin-Aufruf während einer angehaltenen Integration, wartender
Vorbereitung und erneut geplanter automatischer Auswahl. Bestehende
Spielende-/Freilos-/Offiziellen-Regressionen bleiben grün. Berührte Lock-Module
ESLint sauber; in den großen bestehenden Admin-/Match-Modulen keine zusätzlichen
Lint-Befunde gegenüber dem vorherigen Stand.

Messbericht: [performance_ordering_2026-10-11.json](performance_ordering_2026-10-11.json).
Ungekürzte Rohdaten: `/tmp/bts-queue-responsiveness-YFDdyV`; die archivierte
JSON-Zusammenfassung begrenzt nur die großen Listen gehaltener Locks, erhält
deren Anzahl und die tatsächlich kollidierenden Ressourcen.
Anleitung: [queue_responsiveness.md](queue_responsiveness.md).

Gezielter Paarvergleich ohne erneuten Zehnminutenlauf:

```sh
npm run debug:queue-check -- --refs 1d2c63d,8107b82 --phases changed-sync --samples 3
```

## Kontinuierliche Last und zusätzliche Korrektur

Ein erster dreiminütiger Lauf mit Punkten alle 800–1600 ms empfing alle 1.190
Spielstands-/Endemeldungen bei TV und Admin, schloss alle 91 Syncs ab und zeigte
keinen wachsenden Rückstau. Die übrigen Spiele waren jedoch als nicht eingeplant
importiert: Neun Spielenden, keine automatischen Folgeaufrufe. Dieser Lauf
belegt diese zusätzliche Last deshalb nicht. Rohdaten:
`/tmp/bts-queue-responsiveness-tjLynN`.

Die Testbasis wurde anschließend vor Beginn als eingeplant markiert. Ein
90-Sekunden-Lauf mit Punkten alle 400–800 ms deckte wiederholte Auto-Aufruf-
Neuplanungen und einen Sync-Rückstau von bis zu acht unfertigen Vorgängen auf.
Die Diagnose zeigte Änderungen an `needs_preparation_successor` und dessen
Zeitstempel auf unbeteiligten aktiven Spielen. Diese Point-Marker beeinflussen
bei ausgeschalteter automatischer Vorbereitung weder reine Nummernänderungen
noch die automatische Feldkandidatenauswahl, erzwangen aber bisher neue Pläne.

Die zusätzliche Serverkorrektur
`a7623d116265149123e44706c9de4775c62fd577` ignoriert ausschließlich diese beiden
Felder auf **ungesperrten** Spielen in den genannten Fällen. Die Live-Marker
bleiben erhalten. Aktive automatische Vorbereitung, gesperrte Spiele, Spielende,
Check-ins und Zuweisungen werden weiter vollständig geprüft. Beide neuen
Regressionen scheitern auf `8107b82` nach acht Versuchen; mit der Korrektur
gelingen Nummernänderung und echter automatischer Aufruf in einem Versuch.
Gegenproben für notwendige Neuplanungen sowie die gesamte Suite mit **772 Tests**
bestehen.

| 90 Sekunden, gleicher Seed und gleiche Lastparameter | Vorher `8107b82` | Nachher `a7623d1` |
| --- | ---: | ---: |
| TV-Empfang p95 | 566 ms | 37 ms |
| Admin-Empfang p95 | 587 ms | 29 ms |
| TV-Empfang p99 / Maximum | 1195 / 1565 ms | 990 / 1279 ms |
| Admin-Empfang p99 / Maximum | 1225 / 1617 ms | 987 / 1312 ms |
| Zugeordnete TV-Meldungen / gesendet | 936 / 944 | 951 / 951 |
| Zugeordnete Admin-Meldungen / gesendet | 939 / 944 | 951 / 951 |
| Unfertige Syncs, Maximum | 8 | 1 |
| Eintritt in Integrationsfunktion, Maximum | 13,82 s | 0,63 s |
| Syncs abgeschlossen | 46 / 46 | 46 / 46 |
| Erfasste fehlerhafte Verarbeitungs-Traces | 1 | 0 |
| Aufruf-Events während der Simulation, inklusive erstem manuellem Aufruf | 2 | 6 |
| Freie Durchsage, p95 / Maximum | 136 / 218 ms | 75 / 371 ms |

Der Nachlauf leert in beiden Fällen sämtliche beobachteten Scheduler-/DB-Aufgaben.
Nach der Korrektur bleiben alle 13 Felder aktiv belegt; fünf Spielenden führen
zu fünf automatischen Folgeaufrufen. Die verbleibenden vier Neuplanungen haben
berechtigte Gründe: Initialisierung der Turniereinstellungen, tatsächliches
Spielende und geänderte Feldbelegung. Keine erneute Marker-Replan-Schleife.

**Stand vor der nächsten Auswahloptimierung:** Automatische Aufrufplanung dauert
noch etwa 0,8–2,1 Sekunden, davon bis zu 1,3 Sekunden in der Integrationsfunktion;
Event-Loop-Maximum 674 ms. Die Kandidatenprüfung liest wiederholt Turnierlisten,
unter anderem in `has_open_participant_dependency`. Das ist der nächste
gezielt zu profilierende Schwerpunkt. Die freie Durchsage hat im letzten Lauf
sogar ein höheres Maximum; eine allgemein verbesserte Durchsagelatenz ist damit
nicht belegt. Das Ergebnis rechtfertigt noch keine Aussage, dass das gesamte
Turnier unter beliebiger Last ohne wahrnehmbares Delay läuft.

Diese beiden Läufe haben je eine Wiederholung, unterschiedliche tatsächliche
Spielfortschritte und etwas unterschiedliche Beobachter: Der Nachher-Lauf
sichert zusätzlich begrenzte Neuplanungsgründe. Parameter, Seed und Clientstand
`e36022fee0e20b3c2752273c889b4052723595ad` sind gleich. Reproduzierbare
Regressionen stützen die Fehlerkorrektur; die Laufstatistiken sind begrenzte
Lastbelege, kein kontrollierter Langzeit-Kapazitätsnachweis. Periodische Syncs
verwenden den echten validierenden Planer mit realen DB-Writes, erzeugen die
Nummernänderungen aber direkt im privaten Planungsstand. BTP-Transport/XML
liegen außerhalb dieser periodischen Last. Der Paarvergleich oben verwendet
die echte BTP-Antwortintegration mit kontrolliertem Transport-Callback.

Rohdaten vorher: `/tmp/bts-queue-responsiveness-wwoHFO`.
Rohdaten nachher: `/tmp/bts-queue-responsiveness-vCnW5P`.
Der JSON-Bericht archiviert beide Läufe einschließlich Messquellen-Hashes,
Grenzen und der drei Zeitabschnitte. Frühe Diagnose-Reproduktionen mit Sätzen
bis drei Punkte sind separat unter `/tmp/bts-queue-responsiveness-lXy4MW`
gesichert und dienen ausschließlich der Ursachenprüfung.

## Teilnehmerreferenzen in der automatischen Feldkandidatenauswahl

Commit `fb7a66748cb23858e2bfbce07dd84664e657a4bf` ersetzt wiederholte
Turnierdurchläufe durch direkte Referenzen von Teamspielern auf ihre offenen
Matches. Ausschlüsse durch Sonderergebnisse werden einmal je Disziplin
gesammelt. Globale Kandidatenauswahl und sämtliche freien Felder teilen diese
Lookups innerhalb eines synchronen Auswahlvorgangs. Der nächste Vorgang baut
frische Referenzen auf; Reaktivierung, Spielende, neue Teilnehmer und geänderte
Reihenfolge werden berücksichtigt. Spieler-ID-Vergleiche, Vorgängerregeln,
Offiziellenregeln, Locks und anschließende Planvalidierung bleiben erhalten.
Die kleine Klasse liegt in `bts/match_automation/participant_lookup.js`.

Der CPU-Mitschnitt der bisherigen Auswahl bestätigt den Engpass: rund 13,2
Sekunden Selbstzeit entfallen auf `get_match_players` innerhalb des gesamten
Teilbenchmarks. Bei 519 unabhängigen eingeplanten Spielen sinkt der Median
aus fünf Durchläufen für ein freies Feld von 359 auf 9 ms, für 13 freie Felder
von 3.225 auf 16 ms. Beide Versionen liefern dieselben 519 Kandidaten pro Feld.
Diese Werte stammen aus einem reinen Auswahlbenchmark mit CPU-Profiler,
ohne Netzwerk/DB und außerhalb anderer Tests. Sie sind keine Empfangslatenzen.
Quelle, Rohwerte und Profilpfad sind im JSON-Bericht archiviert.

Anschließend wurde ausschließlich der neue Stand erneut für 90 Sekunden
gemessen, mit denselben Parametern und demselben Seed wie der vorhandene
`a7623d1`-Lauf. Messwerkzeuge, Clientquellen/Commit, Abhängigkeiten, Node und
CPU stimmen überein. Die Quelldateien des Servers waren vorher durch die volle
Suite mit **777 Tests** geprüft und als unveränderlicher Commit gesichert.

| Gleiche 90-Sekunden-Lastparameter, je ein Lauf | Vorher `a7623d1` | Nachher `fb7a667` |
| --- | ---: | ---: |
| Tablet → TV, p95 / p99 / Maximum | 37 / 990 / 1279 ms | 32 / 52 / 98 ms |
| Tablet → Admin, p95 / p99 / Maximum | 29 / 987 / 1312 ms | 22 / 46 / 97 ms |
| Empfang bei TV und Admin, jeweils | 951 / 951 | 960 / 960 |
| Freie Durchsage, p95 / Maximum | 75 / 371 ms | 33 / 45 ms |
| Event-Loop-Maximum | 674 ms | 88 ms |
| Score-Handler: beobachtetes Queue-Warten, Maximum | 221 ms | 38 ms |
| Auto-Aufruf: Integrationsphase, Maximum der erfassten Versuche | 1298 ms | 72 ms |
| Auto-Aufruf: gesamter erfasster Vorgang, Maximum | 2099 ms | 630 ms |
| Syncs abgeschlossen | 46 / 46 | 46 / 46 |
| Spielenden / automatische Folgeaufrufe | 5 / 5 | 5 / 5 |

Alle 13 Felder bleiben belegt. Es gibt keine fehlenden Antworten oder
Verarbeitungsfehler; das Serverlog ist leer. In jedem der drei Laufabschnitte
ist höchstens ein Sync unfertig. Scheduler und Datenbank sind nach dem Nachlauf
vollständig geleert. Die sechs Neuplanungen betreffen Initialisierung,
tatsächliche Spielenden und Feldzuweisungen; keine Nachfolger-Marker-Schleife.

Der bisherige JSON-Wert `point_queue_wait_ms` umfasst alle Aufgaben mit
Score-Ursprung, einschließlich nachlaufender Vorbereitung und automatischer
Aufrufe. Deren Maximum beträgt weiterhin 345 ms. Die zusätzliche Aufteilung
nach Aufgabennamen zeigt für den eigentlichen `handle_score_update_v2` maximal
38 ms. Hintergrundarbeit und Empfangslatenzen werden damit getrennt beurteilt.

Weitere Grenzen: Die gesamte Auto-Aufrufplanung erreicht noch 630 ms, darunter
ein Snapshot-Refresh von 476 ms. Dessen Dauer umfasst asynchrone Arbeit und ist
kein Beleg für entsprechend lange CPU-Blockierung. Dieser Refresh-Pfad ist der
nächste gezielt zu untersuchende Engpass. Der Root-Sync bleibt ungefähr gleich
lang im Median (620 → 627 ms); sein Maximum steigt von 1668 auf 1843 ms.
Die Verbesserung betrifft vor allem kurze Empfangszeiten während dieser Arbeit.
Je ein kurzer Lauf und veränderter tatsächlicher Spielfortschritt ergeben
keinen Dauerlastnachweis. Aktive Offiziellen-/Tabletoperator-Zuweisung,
akustischer Clientstart und Browserdarstellung liegen außerhalb dieser Messung.
Freilos-/Offiziellen-/Reaktivierungsregeln sind durch Regressionen geprüft.

Rohdaten: `/tmp/bts-queue-responsiveness-v9q90F`.
Vergleich und Detailphasen: `selection_optimization` im JSON-Bericht oben.
Keine Wiederholung des alten Zehnminuten-Baseline-Laufs.

## Refresh der privaten Planungsdatenbank

Zwei getrennte Optimierungen reduzieren den Snapshot-Refresh und den gesamten
automatischen Aufruf. `ebf27c4f63a4f83df3da7f3ef11c3038552c7d2c` bündelt
private Refresh-Schritte; `6de3740598dc87a9d7547adc7c518e4154f9c58b` ergänzt
die Punktpriorität. Der vorherige Produktionsstand entspricht `fb7a667`
(danach nur der Ergebnis-Commit `f18b009`).

NeDB wickelt eine einzelne Aktualisierung über mehrere Event-Loop-Runden ab.
Der bisherige Refresh wiederholt dies für jedes geänderte Objekt. Ein
Komponententest mit 519 realen, synthetischen Match-Dokumenten zeigt im ruhigen
Prozess einen Median von 128 ms vorher und 53 ms nach der Bündelung.
Mit künstlicher konkurrierender Arbeit von 2 ms pro Event-Loop-Runde werden
daraus 5.546 bzw. 121 ms. Diese künstliche Last verdeutlicht den Mechanismus;
sie ist kein Produktions-Latenzvergleich. Queue-Warten, Laufzeit bis zum
DB-Callback und synchroner Modellaufbau sind separat im JSON aufgezeichnet.

Nur die vom Planner erzeugten privaten In-Memory-Stores dürfen den neuen Pfad
verwenden. Dokumentprüfung, Unique-Indizes, Modell-Hooks und stabile
Objektidentitäten bleiben erhalten. Updates, Inserts und Removes laufen in
der bestehenden Executor-Reihenfolge, maximal 32 Objekte pro Gruppe.
Zusätzlich endet eine Gruppe nach einem zwischen Objekten geprüften
2-ms-Budget. Ein einzelner teurer Datensatz kann dieses Budget überschreiten.
Angepasste Schreiber/Index-/Persistenz-Hooks, TTLs oder Zeitstempel verwenden
den normalen NeDB-Pfad. Die Live-Datenbank und ihre Sync-Write-Bündelung wurden
hier nicht geändert.

Der erste 90-Sekunden-Lauf mit Bündelung allein verkürzt den Refresh auf
maximal 227 ms und den Auto-Aufruf auf 407 ms. Gleichzeitig liegen fünf
TV-Meldungen über 100 ms (Maximum 255 ms), zeitlich beim ersten Auto-Aufruf.
Die Punkt-Traces zeigen verzögerte DB-Schreibcallbacks und wartende TV-
Veröffentlichung, keine lange Wartezeit auf Match-Locks. Ein beobachteter
Persistenzabschnitt dauert 88 ms; diese Dauer allein beweist keine CPU-
Blockierung durch den Refresh. Der Zwischenlauf wird vollständig mitarchiviert.

Die Ergänzung lässt Refresh-Gruppen und größere Vergleichsdurchläufe pausieren,
solange Punkte noch gespeichert und die Score-Veröffentlichung angestoßen
werden. Sie nutzt die vorhandene Punktpriorität (`admin_response_priority`,
standardmäßig aktiv). Das Warten erfolgt außerhalb des privaten DB-Executors
und vor den Integrations-Locks. Aktive eigene Punktkontexte warten nicht auf
sich selbst; Hintergrundarbeit aus bereits freigegebenen Punktkontexten wartet
korrekt auf andere aktive Punkte. Die zusätzliche Wartezeit wird getrennt als
`refresh_foreground_wait_ms` erfasst.

| Gleiche 90-Sekunden-Parameter, je ein Lauf | Vorher | Nur Gruppen | Gruppen + Punktpriorität |
| --- | ---: | ---: | ---: |
| Auto-Aufruf: Refresh-Maximum | 476 ms | 227 ms | 145 ms |
| Gesamter erfasster Auto-Aufruf, Maximum | 630 ms | 407 ms | 278 ms |
| Tablet → TV, p95 / p99 / Maximum | 32 / 52 / 98 ms | 38 / 59 / 255 ms | 39 / 57 / 83 ms |
| Tablet → Admin, p95 / p99 / Maximum | 22 / 46 / 97 ms | 25 / 49 / 179 ms | 24 / 45 / 74 ms |
| Freie Durchsage, p95 / Maximum | 33 / 45 ms | 3 / 59 ms | 5 / 46 ms |
| Event-Loop-Maximum | 88 ms | 107 ms | 88 ms |
| Zugeordnete Meldungen bei TV und Admin, jeweils | 960 / 960 | 961 / 961 | 967 / 967 |
| TV-Meldungen über 100 ms | 0 | 5 | 0 |
| Syncs abgeschlossen | 46 / 46 | 46 / 46 | 46 / 46 |

Im letzten Lauf führen alle fünf Spielenden zu automatischen Folgeaufrufen;
alle 13 Felder bleiben belegt. Keine fehlenden Antworten, kein Verarbeitungs-
fehler, leeres Serverlog. Pro Laufdrittel höchstens ein unfertiger Sync,
anschließend sämtliche beobachteten Scheduler-/DB-Aufgaben abgeschlossen.
Der erste Refresh umfasst 534 Objekte in 40 Gruppen: rund 77 ms Anwendung,
40 ms Queue-Warten und 19 ms gezielte Freigabe für Punkte. Die längste Gruppe
innerhalb der erfassten Auto-Aufrufe dauert 2,22 ms.

Die bisherigen TV-p95/p99 werden durch diesen Schritt nicht kleiner, die
Punkt-Maxima bleiben im abschließenden Lauf unter 100 ms. Der Root-Sync hat
einen ähnlichen Median (627 → 644 ms), ein kleineres Maximum (1843 → 1362 ms).
Nachlaufende Vorbereitung wartet noch bis 280 ms. Diese kurzen Einzelvergleiche
mit unterschiedlichem tatsächlichem Spielfortschritt belegen weder eine
allgemeine Kapazitätsgrenze noch allein den kausalen Anteil der Punktpriorität.
Die Regressionen belegen deren Reihenfolge und Schutz gegen Selbstblockierung.
Aktive Offiziellen-/Tabletoperator-Zuweisung und Dauerlast bleiben separat offen.

Validierung: volle Suite nach Gruppen **785 Tests**, nach Punktpriorität
**786 Tests**; anschließend **98 gezielte Regressionen** einschließlich eines
zusätzlichen Falls mit freigegebenem Punktkontext. Alle geänderten Module und
Tests ESLint sauber. Der JSON-Bericht archiviert unter `refresh_optimization`
die getrennten Quellen, Messwerte, Vergleichsprüfungen und auffälligen Punkt-
Traces. Client, Messwerkzeuge, Parameter, Node/CPU und Abhängigkeiten stimmen
mit dem vorhandenen vorherigen Lauf überein.

Rohdaten nur Gruppen: `/tmp/bts-queue-responsiveness-oNh8IV`.
Rohdaten abschließend: `/tmp/bts-queue-responsiveness-cH7Ngr`.
Der vorhandene Vergleichslauf wurde wiederverwendet; kein alter Baseline-Test
wiederholt. Der zweite neue Lauf prüft gezielt die zusätzliche Punktpriorität.
