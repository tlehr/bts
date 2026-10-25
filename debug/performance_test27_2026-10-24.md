# Test 27: Feste Feldzeilen und aktuelle Spielstatus

Die Feldreihenfolge wurde durch inkrementelle Spielaktualisierungen verändert.
Beim Freigeben eines Feldes entfernte BTS die Zellen, behielt aber dessen
`data-match_id`. Eine spätere Ergebniskorrektur fand dadurch neben der
Ergebniszeile auch die inzwischen freie Feldzeile. Sie wurde als Ergebnis
neu dargestellt und nach Spielreihenfolge beziehungsweise Endzeit verschoben.
Das erklärt die Mischung aus freien Feldern und zuletzt aktualisierten Spielen
in den Screenshots trotz korrekter Erstsortierung von 1 bis 13.

Eine freie Feldzeile verliert jetzt sofort ihre Spielbindung. Zusätzlich
dürfen Ergebnis- und Listenaktualisierungen feste Feldzeilen weder umwidmen
noch verschieben. Diese Zeilen werden weiter einzeln aktualisiert; es gibt
keinen vollständigen Neuaufbau pro Punkt oder Abgleich. Feldzuweisungen,
BTP-Reihenfolge und Turnierdaten wurden für die Diagnose nicht geändert.

## Weitere Befunde aus dem Diagnoseexport

Der Export enthält 42 fehlgeschlagene `court_changed`-Handler während des
Tests. Ihre Ursache ist ein strenger Einzelelement-Selektor für ein Feld,
das in der gerade geöffneten Adminansicht nicht dargestellt wird, etwa in
einer anderen oder gefilterten Unterseite. Die Prüfung auf ein fehlendes
Element kam erst nach dem bereits werfenden Selektor. Die Aktualisierung
verwendet jetzt einen Selektor für null bis mehrere vorhandene Zeilen.

Die sechs Einträge mit insgesamt acht `Cannot read properties of null
(reading 'courts')` stammen aus Wiederverbindungen von BUP vor dem Test.
Beim Öffnen der Verbindung wurde der alte Netzwerkfehler gelöscht und ein
Erfolgs-Callback mit `event: null` ausgelöst, obwohl noch keine Turnierdaten
vorlagen. BUP meldet nun einen Ladezustand bis zur ersten gültigen Antwort;
die Anzeige behandelt auch anderweitig fehlende Turnierdaten als Ladezustand.
Die Korrektur liegt in `bup/js/btsh.js` und `bup/js/displaymode.js`, die über
`static/bup/dev` eingebunden sind.

Die veralteten Status in der Sprachvorbereitung hatten eine andere Ursache.
Sie wurden erst nach einem vollständig abgeschlossenen Generierungsplan
veröffentlicht. Laufende Aufrufe, Änderungen oder neue Adminabfragen können
diesen Plan wiederholt überholen, sodass die zuletzt veröffentlichte
Spielansicht minutenlang zurückbleibt. Die Spiele und ihre feldabhängigen
Durchsagen werden jetzt bereits aus dem jeweiligen gelesenen Stand
veröffentlicht. Das gilt auch, wenn der Generierungsplan anschließend durch
neue Daten ersetzt werden muss. Die Planung von Audio, ihre Prioritäten und
die Persistierung des vollständigen Inventars bleiben davon getrennt.
Die reine Veröffentlichung erzeugt keine Audioaufträge.

Der Diagnoseexport enthält außerdem viele reguläre Online-/Offline-Meldungen
der Testgeräte, die der vorhandene Browsercode als Fehler ausgibt. Die Anzahl
roter Logeinträge ist daher nicht gleich der Anzahl von JavaScriptabstürzen.

## Vollständiger Performance-Lauf

`bts-test-27.json`: 24.10.2026, 17:23:50 Uhr in Berlin, 600.074 ms,
ordnungsgemäß abgeschlossen, kein Testfehler. Anfangs 373 Spiele, 91 beendet,
13 aktiv. Alle 1.119 gesendeten Spielstandmeldungen wurden TV und Admin
zugeordnet. Keine Archivlücken oder verworfenen Einträge; 599 Telemetrieproben,
9.872 archivierte Traces und eine fehlgeschlagene Diagnoseabfrage.

| Empfang | Mittel | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| TV, gesamter Lauf | 8,1 ms | 5 ms | 22 ms | 36 ms | 129 ms |
| Admin, gesamter Lauf | 10,0 ms | 6 ms | 25 ms | 41 ms | 136 ms |
| TV, nach der Ruhephase | 7,0 ms | 4 ms | 20 ms | 25 ms | 40 ms |
| Admin, nach der Ruhephase | 8,7 ms | 6 ms | 23 ms | 28 ms | 42 ms |

Die Gesamt-p99-Werte liegen weiterhin über 30 ms. Beide Empfängertypen haben
sieben Meldungen über 50 ms, davon vier über 100 ms. Diese vier Updates
202–205 liegen zusammen rund 80,8 Sekunden nach Testbeginn. Zwei warten
60,3 beziehungsweise 75,8 ms auf `fetch_sync_apply`; weitere Wartezeit entsteht
beim Lesen und Speichern in der Match-Datenbank. Phasen überlappen und sind
keine addierbaren CPU- oder Plattenzeiten. Diese Spitze ist kein Nachweis
einer Verursachung durch Audio.

In der Lastphase nach der Ruhezeit liegen alle 312 Updates unter 50 ms und
die p99-Werte unter 30 ms. Der Bericht meldet keinen anhaltenden Rückstau;
die Entleerung dauert 467 ms. Die 26 während des Tests protokollierten
Durchsagen enden mit `provider: server`, `status: ok`, ohne Fallback-Grund.

Die seit Test 25 aufgeteilte Vorbereitungsauskunft enthält 13.399 gemessene
Rechenpakete: Median 2,0 ms, p95 4,0 ms, p99 5,5 ms, Maximum 15,8 ms.
Die Startmessung liegt im Median bei 0,1 ms. Sie misst nur den Start und
ersetzt nicht die Zeit aller Rechenpakete. Unterschiedliche Laufbedingungen
erlauben keinen isolierten Geschwindigkeitsnachweis gegenüber Test 25.

## Prüfung der Korrekturen

183 automatische Tests für Feld-/Spielansicht, Wiederverbindung,
Generierungsbedarf, Status, Inventar, Cache und Sprachprozess bestehen.
Drei Integrationsfälle mit echtem Chrome, temporärem BTS und lokalem
FastAPI-Testserver bestehen ebenfalls:

- 13 stabile Feldzeilen bei sechs Spielenden, nachfolgenden Ergebnisedits
  und erneuten Feldzuweisungen; dieselben DOM-Zeilen bleiben erhalten.
- Spielreihenfolge, aufgeklappte Details und inkrementelle Statusänderungen
  der Sprachvorbereitung.
- Eine tatsächliche BUP-Anzeige und deren zentrales Neuladen.

Neue Tests prüfen außerdem die sofortige Entfernung alter Spielbindungen,
den Schutz gegen noch vorhandene alte Bindungen, nicht dargestellte Felder,
Wiederverbindung ohne Turnierdaten und aktuelle Spielstatus trotz permanent
überholter Generierungspläne ohne zusätzliche Audioaufträge.

Die [anonymisierten Messdaten](performance_test27_2026-10-24.json) enthalten
keine Spielernamen. Zur Übernahme BTS neu starten und bereits geöffnete
Admin-/BUP-Seiten neu laden, gegebenenfalls über **Logs & Geräte**. Es wurden
keine eigenen Testpunkte an das laufende Turnier oder BTP gesendet.

## Nachprüfung: Spiel 104 ohne Tabletbediener auf Feld 6

Spiel 76 endet laut Testbericht am 24.10.2026 um 17:24:51 Uhr auf Feld 6.
Spiel 104 wird um 17:24:52 Uhr auf dieses Feld gerufen. Für Spiel 104 ist
`setup.tabletoperators` leer. Sein Spielaufruf wird laut Diagnoseexport um
17:25:07 Uhr gestartet und um 17:25:21 Uhr erfolgreich mit Serveraudio
beendet. Die fehlende Tabletzuordnung entsteht vor der Sprachausgabe.

In der ausschließlich als JSON-Zeilen gelesenen Datenbank existiert für
die Verliererpaarung von Spiel 76 bereits ein Wartelisteneintrag mit
`start_ts` vom 23.10.2026 um 21:50:34 Uhr, `court: -1` und `end_ts: null`.
`court: -1` schließt ihn von der Auswahl aus; freie Wartelisteneinträge
haben `court: null`. Die Einstellung verlangt Bediener vom selben Feld.
`add_player_to_tabletoperator_list_by_match` prüft beim Spielende allerdings
nur, ob überhaupt schon ein Eintrag zu dieser Spiel-ID existiert. Ein
deaktivierter alter Eintrag verhindert daher ebenfalls das erneute Einreihen.

Die Ursache wurde mit dem betroffenen Spieldatensatz und Wartelisteneintrag
in zwei voneinander getrennten In-Memory-Testdatenbanken nachgestellt:
Mit dem alten deaktivierten Eintrag werden keine Bediener ausgewählt und
kein Wartelisteneintrag hinzugefügt. Ohne diesen Eintrag werden die beiden
Verlierer korrekt eingereiht und für Feld 6 ausgewählt. Dabei wurden keine
Live-Daten oder BTP-Daten geändert und keine externen Effekte ausgeführt.

Die Exporte protokollieren nicht, wann oder wodurch der alte Eintrag
deaktiviert wurde. Ein Serverneustart als unmittelbare Ursache ist damit
nicht belegt.

Die Zuweisung prüft jetzt den jeweiligen Spielabschluss statt ausschließlich
der Spiel-ID. Neue Wartelisteneinträge speichern dafür `source_match_end_ts`.
Ein früherer Abschluss blockiert keinen neuen Eintrag; die Historie bleibt
erhalten. Wiederholte Meldungen desselben Abschlusses erzeugen auch nach
einer Queue-Umsortierung, Zuweisung oder Entfernung keine Duplikate. Aktive
Alteinträge ohne Abschlusskennung werden nur berücksichtigt, wenn ihr
Bereitschaftszeitpunkt zum aktuellen Abschluss passt. Deaktivierte
Alteinträge blockieren die Neuanlage nicht.

78 Tests für Abschlussbereinigung, Spieler-/Bedienerstatus, Vorbereitung,
Offiziellenzuordnung und automatische Spielaufrufe bestehen. Die neuen
Regressionen prüfen alte wartende, zugewiesene und deaktivierte Einträge,
die erneute Auswahl der Verlierer, unveränderte historische Einträge und
getrennte Einträge für Doppelpartner. Testcode-Lint, Syntaxprüfung und
`git diff --check` bestehen ebenfalls. Die Korrektur greift nach einem
BTS-Neustart bei folgenden Spielabschlüssen; bereits laufende Spiele wurden
nicht nachträglich verändert.

## Nachprüfung: Vollständige Bausteine trotz „Angaben fehlen“

Die Spielübersicht behandelte eine offene Feldzuweisung unabhängig vom
Audiovorrat als blockierte Durchsage. Das erklärt die Kombination aus
vollständigen Bausteinzählern und „Angaben fehlen“ bei den noch nicht einem
Feld zugewiesenen Spielen im Screenshot.

Die Ansicht prüft jetzt die gemeinsamen Bausteine aller möglichen aktiven
Felder, bei festem Spielort auf dessen Felder begrenzt. Dazu gehören Anfang
und Ende des Feldhinweises, Vorbereitung, Zweitaufrufe und Spielbeginn.
Vollständig vorhandene Varianten erlauben den Status „Bereit“ auch vor
der Feldwahl. Eine fehlende Variante bleibt als konkreter Audiobedarf sichtbar.

Für offene Begegnungen kann V2 zusätzlich den vollständig geladenen
Teilnehmerbestand der jeweiligen Disziplin prüfen: alle Spieler oder festen
Paarungen in sämtlichen benötigten Namenspositionen. Reserve und ausgeschlossene
Meldungen sind ausgenommen. Es werden keine möglichen Turnierergebnisse
berechnet. Sobald die tatsächliche Begegnung feststeht, zählen nur noch deren
Bausteine. Spielstatus und Teilnehmerdaten werden dadurch nicht verändert.

108 automatische Tests für Spielstatus, Vorrat, Bedarf, Kandidaten, Inventar
und Planungsstatus bestehen. Ein zusätzlicher Integrationstest mit Chrome,
temporärem BTS und lokalem Sprach-Testserver bestätigt die Anzeige für offene
Felder und offene Begegnungen, unveränderte DOM-Zeilen und weiterhin ausbleibende
Generierungsanfragen durch die Ansicht. Lint, Syntax und `git diff --check`
bestehen. Für die Übernahme BTS neu starten und die Spielübersicht neu laden.
