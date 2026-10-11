# Isolierter Vergleich: Punkte, Admin-Antwort und Aufrufereignis

Die gebuendelten Sync-Writes bleiben implementiert, aber im neuen Standardprofil
`combined-responsive-background-admin` ausgeschaltet (zuvor
`combined-responsive-single-writes`). Ein Batch blockiert kurzzeitig
auch Arbeit fuer andere Spiele in derselben Collection. Der Vergleich zeigt
keinen durchgaengigen Vorteil ueber alle drei Nutzerziele.

Es wurde kein weiterer zehnminuetiger Live-Test gestartet. Die echten Daten
wurden nach `/tmp/bts-isolated-sync-Xi6nEx/snapshot` kopiert. Nur wegwerfbare
Replikate wurden mit NeDB geoeffnet; Originaldateien stimmen nach der Diagnose
auch per SHA-256 mit der Kopie ueberein.

## Aufbau und gepruefter Zustand

- 519 Spiele, 241 fertig, 13 aktiv; Turnierdatensatz rund 446 KB.
- Deterministische synthetische Aenderung an den Profilen von 46 inaktiven
  Spielen sowie am Event-Datensatz. Kein Replay der letzten BTP-Antwort.
- Produktionspfad fuer Sync-Validierung, Ressourcenplanung, Writes, kanonische
  Objekt-Hooks und Veroeffentlichung. Der private Plan wird lokal aufgebaut;
  Gesamtzeiten enthalten deshalb Arbeit, die live im Planungsworker erfolgt.
- Zwei Warmup-Paare und zwoelf gemessene Paare pro Lastart, wechselnde Reihenfolge.
  Zusaetzlich je Lastart zwoelf gemessene Kontrollen ohne Sync.
- Ein Punkt auf einem unveraenderten aktiven Spiel verwendet die echten
  Kontext-Reads, Match-/Feld-Locks, einen persistierten temporaeren Punktmarker
  und eine serialisierte Score-Benachrichtigung. Die vollstaendige BUP-Verarbeitung
  und TV-Darstellung werden dabei nicht simuliert.
- Gleichzeitige Admin-Anfrage verwendet den echten `handle_tournament_get`,
  einschliesslich QR-Erzeugung, Datenbankabfragen und Antwort-Serialisierung.
  Der manuelle Aufruf verwendet den echten Handler und die Benachrichtigung an
  einen lokalen Admin-Empfaenger, ohne Netzwerk oder Lautsprecher.
- Anfragen werden beim Einreihen des ersten Live-Match-Writes fuer die naechste
  Event-Loop-Runde vorgemerkt. Alle Antwortzeiten enthalten diese Dispatch-Wartezeit.
  Einzel-Writes koennen hier bereits vor ihrem ersten Append die Event Loop
  freigeben; Batches bearbeiten die Gruppe unmittelbar. Das ist Teil der
  untersuchten Scheduling-Wirkung, kein kuenstliches I/O-Delay.

Alle 28 Paare einschliesslich Warmups enden mit identischen Dokument-Hashes.
Alle Aenderungen und der Punktmarker wurden geprueft; NeDB-Reloads stimmen mit
dem Zustand der kanonischen Objekte ueberein und die Match-Identitaet bleibt
erhalten. Die spaetere gezielte Profil-Diagnose prueft nochmals zwei Paare und
Reloads. Ein abschliessender kurzer Smoke-Lauf prueft die fertige Instrumentierung.

## Ergebnisse

Median der gemessenen Server-Antwortzeiten ab der vorgemerkten Anfrage:

| Messung | Einzel-Writes | Batch | Ohne Sync |
| --- | ---: | ---: | ---: |
| Punktmeldung bereit, allein | 2,2 ms | 18,9 ms | 1,2 ms |
| Punktmeldung bereit, parallel zur Admin-Anfrage | 66,7 ms | 28,6 ms | 10,3 ms |
| Vollstaendige Admin-Antwort bereit | 64,7 ms | 86,1 ms | 67,9 ms |
| Manuelles Aufrufereignis bereit, parallel zur Admin-Anfrage | 0,2 ms | 13,8 ms | 1,7 ms |

Der gemischte Fall ist wichtig: Einzel-Writes verbessern nicht pauschal alle
Punktzeiten. Dort erhaelt die Admin-Abfrage frueh den Executor, kopiert alle
Spiele und serialisiert ihre grosse Antwort. Der bereits anstehende Punkt
wartet auf diese Arbeit; mit Batch wird er in diesem Versuchsablauf frueher
fertig. Deshalb sind weder kuerzere Sync-Zeit noch eine einzelne Punktzahl ein
ausreichendes Auswahlkriterium.

Ohne Admin-Anfrage ist die Punkt-Dispatch-Verzoegerung mit Batches im Median
13,8 ms, bei Einzel-Writes unter 0,1 ms. Die Ressourcenqueue benoetigt jeweils
nur rund 0,2–0,3 ms. Die Batch-Verzoegerung entsteht hier ueberwiegend vor dem
eigentlichen Punkt-Task und in der Collection-Barriere. Alle zwoelf Batch-Probes
treffen auf einen laufenden Append, die Einzel-Probes auf dessen vorgelagerten
Scheduling-Schritt. Letztere warten beim Kontextlesen trotzdem auf den Writer.

## Konkreter weiterer Engpass

Die Admin-Antwort hat rund **3,77 MB**, einschliesslich aller Spiele und deren
Historien. Serialisierung und UTF-8-Laengenbestimmung dauern im Median rund
**31–33 ms**. Schon die Kontrolle ohne Sync hat einen maximalen Timer-Verzug
von **55,2 ms im Median der zwoelf Durchlaeufe**. Das belegt Hauptthread-Arbeit
im Admin-Neuladepfad unabhaengig vom Sync. Die gepruefte Antwort bleibt vollstaendig;
es wurden noch keine Nutzdaten weggelassen.

Vier anschliessende CPU-Profile sind auf Live-Writes und Probe-Antworten begrenzt:
Dateiladen, privates Planen, Vergleichs-Hashes und Reloads sind ausgeschlossen.
Sie zeigen Arbeit in NeDB-Kopieren/Validierung/Serialisierung sowie in der grossen
Admin-Antwort. Eine einzelne gezielte Messung je Variante zeigt beim Turnier-Write
etwa **26–28 ms** fuer `model.modify` und **5–11 ms** fuer NeDB-Serialisierung;
beide Writer-Varianten muessen diese Arbeit leisten. Das ist keine neue
Medianmessung ueber zwoelf Stichproben. Verschachtelte Zeiten nicht addieren.

Die erste Unterphasen-Instrumentierung verlor bei asynchronen NeDB-Einzel-Writes
die Collection-Zuordnung fuer `modify`/`serialize`. Deren Nullwerte sind fehlende
Messungen, keine kostenlosen Operationen. Die Antwortzeiten, Append-Zahlen und
Index-Hooks des zwoelfpaarigen Vergleichs sind davon unabhaengig. Die korrigierte
Instrumentierung verwendet `AsyncLocalStorage`; die gezielten Profile pruefen
die Zuordnung fuer beide Writer. Die anfaenglichen unbeschraenkten CPU-Profile
enthielten auch Validierungs-/Reload-Arbeit und werden nicht zur Diagnose verwendet.

## Entscheidung und naechster Ansatz

Einzel-Writes bleiben vorerst Standard: sehr kurze Punktantworten im normalen
Fall, fruehere Admin-Antworten und fruehere Aufrufereignisse. Batching bleibt
explizit mit `--profiles combined-responsive` vergleichbar. Kleinere Batch-Gruppen
waeren ein spaeterer Kandidat, benoetigen aber eine eigene Pruefung von Persistenz,
Rollback, Reihenfolge und Fairness.

Naechste Prioritaet ist der Admin-Neuladepfad: die komplette Antwort seltener
aufbauen, die Listenansicht von bei Bedarf geladenen Match-Details/Historien
trennen oder grosse Kopier-/Serialisierungsarbeit vor dem Versand entkoppeln.
Vor einer Aenderung muessen wir die tatsaechlichen Datenabhaengigkeiten der
Admin-Ansichten und Ansagen pruefen. Historien duerfen nicht fehlen, wo Regeln,
Bearbeitung, Spielstand-Rekonstruktion oder Exporte darauf angewiesen sind.

Die Ansagen laufen im Admin-Browser ueber dessen Speech-Engine. Dieser Test
misst Server-Bereitstellung, keine DOM-Frames, WebSocket-Zustellung, Spielzuteilung,
Speech-Queue oder hoerbaren Audiostart. Diese Browserzeiten sind als weitere
Messziele vorgemerkt; Server-Meldungen allein belegen noch keine fluessige UI
oder unterbrechungsfreie Sprache.

## Reproduzieren und Dateien

`npm run debug:isolated-sync` erstellt eine neue Kopie und vergleicht beide
Varianten einschliesslich Kontrollen. Fortschritt erscheint im Terminal.
Die eingefrorene Kopie dieses Vergleichs laesst sich erneut verwenden:

```sh
npm run debug:isolated-sync -- --source /tmp/bts-isolated-sync-Xi6nEx/snapshot
```

Rohdaten: `report.json`, korrigierte Einzeldiagnose: `bounded-profile-report.json`,
CPU-Profile: `*-bounded.cpuprofile`, jeweils im oben genannten Verzeichnis.
Dauerhafte kompakte Ergebnisse und Provenienz: `debug/performance_runs.json`,
`synthetic_benchmarks.isolated_live_snapshot_sync_write_comparison`.
Die letzte gemessene Paarung pro Lastart enthaelt Profiler-Overhead;
absolute Zeiten gelten nur fuer diese isolierte Umgebung.
Zwoelf Stichproben liefern keine belastbare Live-p99-Aussage.

Geprueft: 19 gezielte Profil-/Batch-Tests, Reload-/Paritaetspruefungen im Vergleich,
abschliessender Smoke-Lauf, ESLint fuer die geaenderten Diagnosemodule und
`git diff --check`.

## Admin-Neuladen mit nachgeladenen Historien

Der anschliessend freigegebene Schritt reduziert die Admin-Antwort: Bei explizitem
`defer_finished_history: true` enthaelt die Uebersicht keine Tastendruckhistorie
beendeter, nicht mehr auf dem Feld stehender Spiele. `presses_deferred: true`
kennzeichnet die fehlende Historie; sie wird nicht als leere Historie ausgegeben.
Ergebnisse, Spieler, Offizielle und alle anderen Felder bleiben erhalten.
Laufende Spiele und Vorbereitungen behalten ihre Historien fuer die Timer.
Vor Bearbeitung oder Spielberichtsbogen fragt `match_history_get` die Historie
des konkreten Spiels innerhalb des angegebenen Turniers ab. Der Sammel-Export
liest weiterhin die vollstaendigen Spiele. Alte Clients ohne Opt-in erhalten
die bisherige vollstaendige Antwort.

Der neue Leser kopiert die schlanken Datensaetze direkt aus dem Objektmodell,
ohne zuvor die ausgeschlossenen Historien zu kopieren. Er wartet im
Match-Executor hinter frueheren Writes; es kommt kein Turnier- oder Ressourcen-
Lock hinzu. So sieht die Antwort keine noch nicht bestaetigten Writes.
Der Browser verwirft Detailantworten nach Navigation, Turnierwechsel oder
Austausch des Matchobjekts. Neuere Live-Historien haben Vorrang vor einer
ausstehenden Detailantwort. Doppelte Klicks teilen eine Anfrage.
Die Umsetzung liegt in kleinen Modulen `bts/admin_match_data.js` und
`static/js/cmatch_history.js`.

Vergleich: `/tmp/bts-isolated-admin-iauuVO/report.json`, erneut die unveraenderte
Quelle `/tmp/bts-isolated-sync-Xi6nEx/snapshot`, 519 Spiele, davon 241 beendet,
13 aktiv. 239 beendete Spiele haben auslassbare Historien. Je Lastart zwoelf
gemessene Paare plus zwei Warmup-Paare, abwechselnde Reihenfolge, frische Datei-
Replikate. Beide Varianten nutzen Einzelwrites, keine CPU-Profiler-Sitzung.
Die Sync-Last aendert wie zuvor 46 inaktive Spielerprofile und ein Events-Feld.

| Median pro Durchlauf | Vollstaendig | Historien bei Bedarf |
| --- | ---: | ---: |
| Admin-Antwortgroesse, ohne Sync | 3.774 MB | 2.441 MB |
| Admin-Antwort bereit, mit Sync | 67.6 ms | 46.5 ms |
| Admin-Antwort bereit, ohne Sync | 69.8 ms | 48.4 ms |
| JSON + UTF8-Laenge, mit Sync | 32.7 ms | 20.4 ms |
| Punktmeldung bei parallelem Admin + Sync | 66.7 ms | 48.3 ms |
| Punktmeldung bei parallelem Admin, ohne Sync | 10.8 ms | 11.2 ms |
| Aufrufereignis bereit, mit Sync | 0.3 ms | 0.3 ms |
| Aufrufereignis bereit, ohne Sync | 1.0 ms | 0.3 ms |
| Maximaler Timer-Verzug je Durchlauf, mit Sync | 54.6 ms | 41.7 ms |
| Maximaler Timer-Verzug je Durchlauf, ohne Sync | 53.0 ms | 34.6 ms |

MB sind dezimal. Die Antwort verliert rund 35 Prozent ihrer Bytes. Der groesste
Timer-Verzug mit Sync verbessert sich nicht: 87.8 gegen 88.3 ms. Andere Sync-/
Scheduling-Arbeit bleibt vorhanden. Die Punktmeldung ohne Sync zeigt im Median
keinen Geschwindigkeitsgewinn; die Entlastung ist bei gleichzeitigem Sync
sichtbar. Zwoelf Stichproben erlauben keine belastbare Live-p99-Aussage.
Punktmessung weiterhin Kontext + persistierter Testmarker + Admin-Ereignis,
kein kompletter BUP-Punkt oder TV-Rendering. Aufrufmessung betrifft die
serverseitige Ereignisbereitschaft, weder Spielzuweisung noch hoerbaren Beginn.
Browser-Parsing, DOM-Zeiten und Frames sind in diesen Latenzwerten ungemessen.

Alle 28 Paare speichern identische Dokumente, bestehen NeDB-Reload und behalten
die kanonische Matchidentitaet. SHA-256 und Metadaten der Quelle unveraendert.
83 gezielte Tests bestanden: Historien-/Frontend-Verhalten, Persistierreihenfolge,
Reaktivierung, Byes/No-Match-Kaskade, Timer, Ansageprioritaet und TV-Fanout.
ESLint fuer neue Module/Tests und geaenderte Diagnosemodule sowie Syntaxchecks
der beteiligten bestehenden Module und `git diff --check` bestanden.

Zusaetzlicher echter Headless-Chrome-Smoke mit Original-HTML, Clientskripten,
WebSocket-Handlern und temporaerer DB: 519 Spiele geladen, 241 fertige Zeilen
gerendert, 239 Historien zurueckgestellt; Bearbeitungsdialog mit nachgeladenen
85 Tastendruecken und Spielberichtsbogen als SVG erfolgreich. Keine Browser-
Fehler und Quelle unveraendert. Dieser Smoke misst keine Frame-Latenzen oder
Sprachausgabe. Bericht: `/tmp/bts-admin-browser-7ZMFRQ/report.json`;
isoliertes Diagnosescript: `/tmp/bts-admin-browser-smoke.js`.

Wiederholung ohne laufenden BTS-Prozess oder Veraenderung des Live-Turniers:

```sh
npm run debug:isolated-admin -- --source /tmp/bts-isolated-sync-Xi6nEx/snapshot
```

Offen bleiben serverseitig die grossen Events-/Spielerprofile,
Turnier-Modify/Serialisierung und getrennte Collection-Batch-Barrieren.
Tim hat den aktuellen Zielpunkt anschliessend praezisiert: Es reicht vorerst,
wenn die Nachricht fuer Punkte, Admin-Antworten und Aufrufe am Client ankommt.
Weitere Client-Optimierung sowie Frame-/Rendering-/Audio-Messungen sind derzeit
nicht erforderlich. Spaetere Live-Messungen sollen Versand/Transport bis zum
Nachrichtenempfang einschliessen; die hier gemessene serverseitige Bereitschaft
ist noch kein Nachweis des Empfangs. Adminseite fuer den neuen Anfragepfad neu laden.

## Weitere Serveroptimierungen und echter Nachrichtenempfang

Am 2026-10-11 autonom freigegeben und umgesetzt. Standardprofil jetzt
`combined-responsive-background-admin`; vorbereitete Turnier-Writes, kooperative
Admin-Antwort und Punktpriorität auch ohne Sequenzprofil standardmäßig an.
Die früheren Profile behalten ihre Bedeutung durch explizites Zurücksetzen
der neuen Schalter. Gebündelte Writes und Admin-JSON-Worker bleiben aus.

### Vorbereitete Turnieränderungen

NeDB prüft Arrayelemente sowohl über `forEach` als auch über `Object.keys`;
verschachtelte Arrays werden mehrfach besucht. Die neue Prüfung besucht nur
neue Werte, jeden Teilbaum einmal. Unveränderte, bereits geprüfte Revisionsteile
werden geteilt, geänderte Eltern kopiert. Vorbereitung liegt vor dem Warten auf
Ressourcen-Locks. IDs, NeDB-Indizes, kanonische Objektidentitäten und Append-Barriere
bleiben erhalten. Unsupported Pfade/Modifier, Custom Writer, TTL und Zeitstempel
nutzen den bisherigen Pfad. Bei geändertem Ausgangsdokument wird das normale
NeDB-Update auf den aktuellen Stand angewendet. Statistiken unterscheiden
tatsächlich verwendete Vorbereitung und diesen Rückfall.

Registrierungs-Metadaten lösen keinen erneuten Aufbau derselben Spielerprofile
aus. Auf einem fehlgeschlagenen Append werden Daten und die ursprünglichen
Registrierungs-Profilrevisionen zurückgesetzt. Neuere matchbezogene Profile
bleiben erhalten, auch bei parallelem Match-Write. Fehlerfälle wurden mit
Teil-Append und anschließendem NeDB-Reload geprüft.

Bericht `/tmp/bts-isolated-transport-hJtlpY/report.json`: gleiche eingefrorene
519-Spiele-Kopie, 12 Messpaare + 2 Warmups je Lastart, 42 gleiche Endzustände/
Reload-Paare. Ein Empfängerprozess/eine Verbindung für drei gleichzeitige
Anfragen. Start jetzt beim ersten Live-Write inklusive Turnier, nicht wie früher
beim ersten Match-Write. Daher keine direkte Zuordnung zu älteren Bereitschaftswerten.

| Median ab tatsächlichem Senden bis Empfang | Normaler Write | Vorbereitet |
| --- | ---: | ---: |
| Punkt, Metadaten-Sync + Admin | 54.5 ms | 12.9 ms |
| Admin, Metadaten-Sync | 109.2 ms | 64.4 ms |
| Aufruf, Metadaten-Sync + Admin | 41.9 ms | 1.4 ms |
| Punkt, Registrierungsänderung + Admin | 50.6 ms | 14.7 ms |
| Admin, Registrierungsänderung | 102.6 ms | 67.8 ms |
| Aufruf, Registrierungsänderung + Admin | 38.9 ms | 1.3 ms |

NeDB-Turnier-Modify-Median 31.3/30.3 ms; vorbereitet entfällt dieser Aufruf.
Die gesonderte Vorbereitung kostet 0.1 ms bei Metadaten und 3.9 ms bei ersetztem
Registrierungsarray. Serialisierung bleibt bei etwa 5–6 ms. Zwei vorbereitete
Registrierungs-Durchläufe zeigen Punkte von 80.1/89.6 ms: Die große Admin-Antwort
kann vor dem Punkt passieren. Die Maxima verbessern sich hier also nicht
durchgehend. Ohne Sync Punkt 10.9/9.7 ms, Admin 73.3/73.8 ms, Aufruf jeweils 1.2 ms.

### Admin-Arbeit und Persistierungspriorität

Die Diagnose verwendet für weitere Schritte getrennte Prozesse/Verbindungen
für Punkt, Admin und Aufruf. Punkt/Aufruf senden 30 ms nach Start der Adminlast;
Zeitmessung beginnt beim tatsächlichen Senden. Das ist eine feste Überlappung
mit deren Verarbeitung, kein Test sämtlicher Ankunftszeitpunkte. Diese Werte
sind nicht mit dem vorherigen Ein-Verbindungs-Test aggregierbar.

1. JSON-Worker isoliert geprüft: `/tmp/bts-isolated-transport-xBj37T/report.json`,
   12 Messpaare + 2 Warmups je Lastart. Punkt-Median bei Metadaten 32.8 -> 21.7 ms,
   bei Registrierung 33.2 -> 27.1 ms; Aufruf 27.1 -> 17.0 bzw. 29.7 -> 5.4 ms.
   Admin dagegen 72.6 -> 112.0 bzw. 72.3 -> 121.6 ms. Daher optionaler Vergleich
   `BTS_ADMIN_RESPONSE_ENCODER=worker`, kein Standard.
2. Kooperatives Kopieren/Encoding: `/tmp/bts-isolated-transport-fDHf9S/report.json`,
   8 Messpaare + 2 Warmups je Lastart. Aufruf 20.1 -> 3.4 bzw. 23.7 -> 3.3 ms;
   Admin 62.1 -> 72.8 bzw. 63.6 -> 72.7 ms. Punkt zunächst schlechter: 22.2 -> 31.6
   bzw. 25.3 -> 31.4 ms. Kurze CPU-Abschnitte allein verzögern noch die mehreren
   asynchronen Schritte der Punktpersistierung. Dieser Bericht entstand vor
   Ergänzung der Reservierung bereits beim Beginn der Admin-Abfrage.
3. Nur Punktpriorität zusätzlich zur kooperativen Antwort:
   `/tmp/bts-isolated-transport-IYgbwI/report.json`, 8 Messpaare + 2 Warmups je Lastart,
   30 identische Endzustände/Reload-Paare. Reservierung und getrennte Empfänger
   in beiden Varianten. Admin-Hintergrundarbeit pausiert während der laufenden
   Punktaufgabe bis zur Veröffentlichung; keine zusätzlichen Locks.

| Median, Vergleich 3 | Kooperativ | Zusätzlich Punktpriorität |
| --- | ---: | ---: |
| Punkt, Metadaten-Sync | 32.7 ms | 7.2 ms |
| Punkt, Registrierungs-Sync | 30.5 ms | 7.7 ms |
| Punkt, ohne Sync | 31.9 ms | 8.2 ms |
| Aufruf, Metadaten-Sync | 3.0 ms | 3.1 ms |
| Aufruf, Registrierungs-Sync | 2.7 ms | 3.4 ms |
| Admin, Metadaten-Sync | 75.1 ms | 76.4 ms |
| Admin, Registrierungs-Sync | 71.6 ms | 74.3 ms |
| Admin, ohne Sync | 82.8 ms | 84.5 ms |

Empirische Punkt-Maxima im Prioritätsvergleich: Metadaten 41.2 -> 10.4 ms,
Registrierung 46.4 -> 13.6 ms, ohne Sync 42.2 -> 12.7 ms. Keine Produktions-p95/
p99-Aussage aus acht lokalen Stichproben. Die Gesamtübersicht wird durch kurze
Abschnitte etwas langsamer, andere Anfragen bleiben reaktionsfähig. Bei dauernder
Punktlast kann die Übersicht länger warten. Nach Punktveröffentlichung pausiert
sie nicht für die gesamte Spielende-Bereinigung.

Eine Admin-Abfrage reserviert ihre Reihenfolge auf der eigenen Verbindung schon
vor den DB-Reads. Spätere Änderungen folgen auf die Übersicht; sie werden beim
Einreihen kodiert und nicht aus später mutierten Objekten rekonstruiert. Andere
Verbindungen bleiben unabhängig. Das Kopieren selbst liegt außerhalb des Match-
Executors, nachdem die Referenzen hinter früheren Writes aufgenommen wurden.
Die Abschnitte zielen auf 2 ms; ein einzelner großer Wert ist nicht unterbrechbar.

### Spielende und verbleibende Grenzen

Die Spielende-Aufgabe sperrt bei bekanntem Feld nur dieses Feld, ihr Match und
die bisherigen Vorbereitungs-/Offiziellen-/Tabletoperator-/Auto-Call-Domänen.
Die eigentliche Belegung freier Felder bleibt eine gesonderte Aufgabe mit ihren
eigenen Locks. Ohne Feld-ID bleibt die Collection-Sperre. V2-Endzeitstempel
werden vor der Lock-Auswahl in Boolean umgewandelt, damit die Cleanup-Domänen
auch für numerische Zeitstempel greifen. Admin-Bestätigung eines inzwischen
verschobenen Spiels wird vor Änderungen zurückgewiesen. Gleiches Feld und
Feldvergabe warten weiter; Punkte auf unabhängigen Feldern können fortfahren.
Dies ist per Queue- und Handler-Regressionsprüfung belegt, kein eigener gemessener
Live-Latenzgewinn. Byes, Spieler-/Offiziellen-Verweise und Cleanup bleiben erhalten.

Feinere Collection-Batches werden nicht als weiterer Standard eingebaut:
Batch-Writes sind aus, und die bisherigen Messungen belegen keinen durchgängigen
Nutzen für die drei Nutzerziele. Implementierung und Vergleich bleiben verfügbar.
Verbleibende Turnier-Serialisierung von rund 5–6 ms wird weiterhin gemessen;
eine Auslagerung jeder kleinen Operation ist nicht pauschal vorteilhaft.

Alle Varianten verwenden echte lokale WebSocket-Frames ohne Kompression. Der
Empfangszeitpunkt liegt am Anfang des Message-Callbacks vor Anwendungs-Parsing.
Der Punkt bleibt Kontext + persistierter Marker + echte Score-Benachrichtigung,
kein vollständiger BUP-Punkt. Aufruf nutzt den manuellen Produktionshandler,
keine Matchzuweisung. Private Sync-Planung läuft in der Diagnose lokal statt im
Produktionsworker; Timer-Maxima enthalten sie. Keine Live-Turnieränderung,
Browser-Frame-/Audio-Messung oder Annahme echter LAN-Latenz. SHA-256/Metadaten
der Quelle und gepaarte persistierte Dokumente stimmen in jedem Vergleich.

Validierung: abschließend 692 Tests in der vollständigen Suite mit neuen
Standardwerten (`BTS_TABLETOPERATOR_AUDIT=0`). Zusätzlich 84 gezielte
Prüfungen einschließlich Registrierung-Rollback,
parallelem Profil-Write, Sync-Neuplanung, Datumswerten, Indexkonflikten, Encoder-
Fallback, Nachrichtenreihenfolge und Prioritätsfreigabe. Tatsächlicher Chrome-
Smoke `/tmp/bts-admin-browser-EcI0hy/report.json`: 519 Spiele, 241 fertige Zeilen,
239 zurückgestellte Historien, Edit mit 85 Presses und Scoresheet-SVG, keine
Browserfehler, Quelle unverändert. ESLint der betroffenen neuen Module/Tests,
Syntaxprüfungen bestehender Handler und `git diff --check` bestanden.

Abschließender Transport-Smoke nach der Profil-Rollback-Korrektur:
`/tmp/bts-isolated-transport-v9xfAO/report.json`, drei Messpaare ohne Warmup,
alle Endzustände/Reloads und neun Empfängerantworten pro Variante geprüft.
Dieser kurze Lauf bestätigt Verhalten, keine neue Latenzstatistik. Die getrennten
Berichte samt Quellen-Hashes, Profilentscheidung und Zusammenfassungen sind
unter `synthetic_benchmarks` in `debug/performance_runs.json` archiviert.
Testlog der Gesamtsuite: `/tmp/bts-final-validated-tests.log`.
