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

**Offen bleiben spürbare Einzelspitzen.** Automatische Aufrufplanung dauert
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
