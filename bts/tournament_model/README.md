# Turnierobjekte im Speicher

`database.setup_helpers()` bindet das Modell einmal an die Datenbank. Die
bestehenden Schreibwege aktualisieren danach automatisch dieselben
Laufzeitobjekte, einschließlich Callback-Schreibvorgängen, Upserts und Rollbacks.

```js
const tournament = app.db.model.tournament('default');
const match = tournament.matches.get(match_id);
const participation = match.participations.get('team:0:0');
const player = participation.player;

match.court;            // dasselbe Court-Objekt wie tournament.courts.get(id)
match.court.location;   // kanonisches Objekt der Spielstätte
match.court.match;      // durch court.match_id zugeordnetes Match
player.matches;        // Set direkter Match-Referenzen
player.participations; // Set der Spielteilnahmen, auch als Tabletbediener
match.umpire;          // kanonisches Official-Objekt
match.service_judge;   // Aufschlagrichter, ebenfalls ein Official
match.umpire.matches;  // Set direkter Match-Referenzen
match.umpire.assignments; // Rollen mit match, role und official
match.fingerprint('score'); // Hash des Spielstands, bei Bedarf berechnet
match.fingerprint('participants'); // Teilnehmer und Zuweisungen
match.fingerprint('normalization'); // Eingaben fuer Pausen-/Offiziellen-Abgleich
player.fingerprint();   // gemeinsames Profil, ohne Check-in der einzelnen Spiele
```

Spieler sind über ihre BTP-ID innerhalb eines Turniers eindeutig. Unbekannte
Spieler mit ID `-1` erhalten eine eigene Identität je Spielposition. Match- und
Feldidentitäten folgen den NeDB-IDs. Referenzen können bereits vor dem Eintreffen
eines Datensatzes entstehen; `present` zeigt, ob er tatsächlich gespeichert ist.
Gelöschte Objekte werden aus den aktiven Sammlungen entfernt, bleiben über
bestehende Referenzen erkennbar und werden bei erneutem Import wiederverwendet.

## Verantwortlichkeiten

| Datei | Aufgabe |
| --- | --- |
| `player.js` | Gemeinsames Spielerprofil und Rückverweise |
| `participation.js` | Spieler in einer Matchposition, Check-in und Pausenstatus |
| `match.js` | Match, Teilnehmer und Feldbeziehung |
| `court.js` | Feld, zugeordnetes Match und Spielstätte |
| `tournament.js` | Turnier und seine aktiven Sammlungen |
| `entity.js` | Gemeinsame Datensatzidentität, Revision und Existenzstatus; auch für Spielstätten |
| `official.js`, `official_assignment.js`, `official_links.js` | Aktuelles Offiziellenprofil, Matchrollen und Rückverweise |
| `model.js` | Objektidentitäten, Einfügen, Aktualisieren und Entfernen |
| `relations.js` | Spieler-ID/Feld-ID → Match-IDs und bereits entblockte Matches mit unveränderlichen Indexrevisionen |
| `registrations.js` | Spielerprofile aus dem Disziplin- und Meldedatenpaket |
| `datastore.js` | NeDB-Anbindung, geordnete Snapshots und gezielte Spielerabfragen |
| `cleanup_reads.js` | Kleine Match-/Einstellungsprojektionen und gezielte Abfragen beim Spielende |
| `score_reads.js` | Direkte, geordnete Kontextabfragen für Punktmeldungen mit getrennten Queue-/Lesezeiten |
| `fingerprints.js`, `fingerprint_projections.js` | Zwischengespeicherte SHA-256-Hashes und ihre fachlichen Datenbereiche |
| `fingerprint_index.js`, `normalization_fingerprints.js` | Sammelhashes aus Objekt-Hashes und Normalisierungs-Signatur |
| `normalization_reads.js` | Geordnete Hashpruefung und optionale bearbeitbare Snapshots |
| `player_ids.js`, `profile_fields.js` | Einheitliche Identifikation und Trennung der Profildaten |

## Änderungen und Syncs

`entity.data` ist der aktuelle, nur zu lesende Datenbankstand. Änderungen erfolgen
über die vorhandenen Datenbankfunktionen innerhalb der dafür vorgesehenen Locks.
Das Entity-Objekt bleibt identisch; seine Revision und Beziehungen werden beim
Schreiben angepasst. Profilobjekte bleiben ebenfalls identisch. Check-in,
Pausen- und Feldstatus liegen auf der Spielteilnahme, damit verschiedene Spiele
eines Spielers eigene Zustände behalten können.

Datenbank und API verwenden weiterhin serialisierbare Datensätze mit eingebetteten
Spielerdaten. Die direkten Beziehungen gehören zum Laufzeitmodell. `toJSON()`
vermeidet zyklische Referenzen. Die vorhandenen Sync-Helfer arbeiten auf einem
eigenen Planungsmodell; Änderungen darin erreichen das Live-Modell erst beim
erfolgreichen Schreiben des Plans.

Ein Snapshot hält die gelesenen Datensatz- und Beziehungsrevisionen fest.
Spätere Schreibvorgänge ersetzen NeDB-Datensätze und erzeugen bei geänderten
Beziehungen neue Indexrevisionen. Reine Punkteänderungen verwenden denselben
Beziehungsindex weiter. So berechnet die Lock-Planung ihre Abhängigkeiten aus dem
tatsächlich gelesenen Stand, ohne alle Matches nach Spielern oder Feldern zu
durchsuchen. Die vorhandene Validierung und die Vergabe-Locks bleiben Teil der
Integration. Die Aktualisierung von Spieler-Feldzuständen liest über denselben
Index nur betroffene Matches und bekommt dafür isolierte, bearbeitbare Kopien.

Punktmeldungen lesen mit `model.read_score_context_part(part, key, id, callback)`
Spiel, Turniereinstellungen und Feld direkt aus ihren Objektindizes. Die Abfragen
laufen grundsätzlich in den jeweiligen NeDB-Executors: Ein Schreibvorgang kann
das Objektmodell bereits aktualisiert haben, während seine Persistierung noch läuft.
Die Rückgabe enthält isolierte Kopien; Turniermeldungen werden nicht kopiert.
Spielhistorien bleiben für die bestehende Erkennung unveränderter Punktmeldungen
enthalten. Die drei Abfragen sind parallel, kein gemeinsamer Turnier-Lock wird
ergänzt. Unvollständige Test-Datenbanken verwenden die bisherigen Abfragewege.
Bei aktiven Timing-Flags ergänzt `database_tasks.js` im übergeordneten BTS-Modul
Informationen zur laufenden und zuletzt abgeschlossenen Datastore-Aufgabe.
Queue-Tiefe allein erfasst laufende Aufgaben und noch ausstehende Freigabe-
Callbacks nicht. Die Diagnose beobachtet NeDBs bestehende Executor-Aufrufe;
sie führt keine zusätzliche Datastore-Aufgabe oder Sperre ein.

Mit `BTS_COMPACTION_MODEL_READS=1` kann ein Punkt-Read während einer tatsächlich
laufenden reinen Kompaktierung auf den Executor verzichten. Das kleine Modul
`../database_read_barrier.js` beobachtet laufende und wartende Aufgaben unabhängig
vom Timing-Logging. Frühere Writes, unbekannte Aufgaben, Reloads, nicht erfasste
Queue-Aufträge oder TTL-Indizes verhindern den schnellen Pfad. Reine NeDB-Reads
und ausdrücklich zertifizierte Modell-Reads dürfen passiert werden. Der Read
erstellt sofort eine isolierte Kopie, liefert den Callback aber asynchron.
Spätere Writes bleiben hinter dem Rewrite eingereiht. Der schnelle Pfad ist für
Match, Turnier und Feld verfügbar; Sync-Snapshots und Cleanup-Reads bleiben
weiterhin im Executor. `compaction_read_bypassed` und `compaction_read_decision`
nennen die Entscheidung. Erfolgreiche schnelle Reads werden bei Timing-Logging
als `database:compaction_model_read` protokolliert.

Punkte können außerdem reine Leseaufträge passieren, wenn sämtliche früheren
laufenden und wartenden Aufträge als Leser erkannt sind. Die Beobachtung behält
die Identität eines Auftrags bis zur tatsächlichen Freigabe seines Queue-Slots;
das schließt NeDBs Verzögerung nach dem Datastore-Callback ein. Unbekannte oder
nicht beobachtete Aufträge, frühere Writes, Reloads und TTL-fähige Leser sperren
diesen Pfad. Auch ein erst während des Wartens hinzugefügter TTL-Index wird
berücksichtigt. Ein späterer Write bleibt im Executor; die Punktabfrage erhält
die bereits erstellte, isolierte Kopie asynchron. `BTS_SCORE_MODEL_READONLY_READS=0`
schaltet diese Erweiterung aus. Das Performance-Profil nennt
`score_readonly_reads`, eine schnelle Abfrage `model_read_decision: read_only_store`.

Die automatische Vorbereitung verwendet standardmäßig geordnete Modell-Snapshots
für Bedarf, automatische Kandidaten, Zulässigkeit und die Prüfung des Aufrufabstands.
Unveränderte Historien und Meldedaten werden dafür nicht kopiert. Die konfigurierten
Mindestabstände, Offiziellenregeln und Schreibwege bleiben erhalten. Öffentliche
Kandidatenantworten liefern weiterhin bearbeitbare, isolierte Kopien.
`BTS_PREPARATION_MODEL_READS=0` aktiviert den bisherigen Abfrageweg. Snapshot-Reads
prüfen TTL-Indizes bei Ausführung, auch wenn ein Index erst nach dem Einreihen
angelegt wurde; dann übernimmt der normale NeDB-Cursor die Ablaufprüfung.

`sync_validation.js` besucht für die Sync-Validierung unveränderte kanonische
Datensatzrevisionen im Executor ohne NeDB-Scan und Ergebnis-Kopien. Änderungen,
Löschungen und neue Datensätze werden weiterhin geprüft; konkurrierende Punkte
werden nur unter den vorhandenen Regeln übernommen. TTL-Reads behalten ihren
Cursor. Weder Sync-Reads noch Vorbereitung umgehen Persistierungs-Barrieren.

Nach einem erfolgreichen Punkte-Append kann `../score_publication/committed_points.js`
den gespeicherten Stand direkt an verbundene TVs senden, die genau dieses Spiel
anzeigen. Feld und Match sind dabei noch durch die validierte Punkteoperation
geschützt. Es gibt keinen Cache eines früheren Punktes. Neue Zuordnungen,
Darstellungseinstellungen, Timer, Tabellen und vollständige Ansichten verwenden
weiterhin den regulären Aktualisierungspfad; TTL-Kontexte nehmen keine Abkürzung.

## Objekt-Hashes

Jedes Entity kann mit `fingerprint()` seinen vollständigen Datensatz hashen.
Matches bieten außerdem `score`, `participants` und `normalization`. Die
Normalisierungs-Projektion enthält dieselben fachlichen Eingaben wie die bisherige
Prüfung: Ergebnisse, Endzeiten, Spieler-IDs und Einsatzzeiten, Matchzustand,
Feldzuordnung und eingebettete Offizielle. Turniere liefern hierfür Identität,
Reset-Zeitpunkt und BTP-Einstellungen; Offizielle ihren aktuellen Datensatz.
Gewöhnliche Punkte, Tastendruckhistorien und Spieler-Check-ins verändern den
Normalisierungs-Hash nicht. Ein Profil-Hash auf `Player` berücksichtigt das
gemeinsame Profil aus Meldungen und Matchteilnahmen, ohne deren eigene Zustände.

Die Hashes gehören zum Laufzeitmodell und werden nicht in NeDB-Datensätzen oder
API-Antworten gespeichert. Objektfelder werden für das Hashen nach Namen sortiert;
Arrayreihenfolgen und Datumswerte bleiben erhalten. Unveränderte fachliche
Projektionen übernehmen den bereits berechneten Hash auch bei einer neuen
NeDB-Datensatzrevision. Normalisierungs-Hashes werden bei Schreibänderungen
gepflegt, andere Hashes beim ersten Zugriff auf einen geänderten Datenbereich.

Je Turnier und Sammlung speichert ein Index die Objekt-Hashes. Nur ein geänderter
Hash, ein eingefügtes oder entferntes Objekt invalidiert seinen Sammelhash.
`model.normalization_state(key)` liest diese kleinen Sammelhashes in der
Datenbankreihenfolge. Ein unveränderter Aufruf durchläuft weder Match-Setups noch
Objekt-Hashes. Erst bei Änderungen liest `normalization_state(key, true)` die
bearbeitbaren Setup-Snapshots ohne Punktehistorien und Disziplinpakete.

Der Normalisierungs-Cache wird erst nach erfolgreich abgeschlossenen Schreibvorgängen
aktualisiert. Maßgeblich ist der tatsächlich verarbeitete Snapshot einschließlich
seiner Änderungen; gleichzeitig hinzugekommene Änderungen dürfen nicht als
bereits verarbeitet gelten. Löschungen, Turnierwechsel, Resets und NeDB-Rollbacks
laufen ebenfalls über die zentralen Modell-Hooks. Zeitabhängige Pausenprüfungen
und Freilosweitergabe laufen weiterhin in ihren bisherigen Sync-Schritten.
