# Getrennt schaltbare Auslagerungen

Die bisherigen Auslagerungen bleiben einzeln schaltbar. BTP-Decodierung,
Sync-Planung mit Rückgabe der Änderungen, vorbereitete Turnier-Writes und kooperative Admin-Antworten mit Punktpriorität
sind standardmäßig eingeschaltet. Jeder Schalter wird
unabhängig ausgewertet (`1` ein, `0` aus):

| Schalter | Standard | Wirkung |
| --- | --- | --- |
| `BTS_BTP_DECODE_WORKER` | `1` | Große BTP-Antworten im Decoder-Worker; kleine Bestätigungen direkt. |
| `BTS_SYNC_PLAN_WORKER` | `1` | BTP-Integration, Normalisierung und Auto-Call-Planung auf privatem Speicherstand im Planungsworker. |
| `BTS_SYNC_PLAN_PATCH_RETURN` | `1` | Planungsworker gibt bei bestehenden Objekten nur geänderte Felder zurück; benötigt `BTS_SYNC_PLAN_WORKER=1`. |
| `BTS_DEVICE_INFO_BACKGROUND` | `0` | Geräteinformationen aus Punktmeldungen über eine asynchrone Queue je Gerät nachziehen. |
| `BTS_XLSX_IMPORT_WORKER` | `0` | XLSX-Datei im Importworker lesen; Zuordnung und Speicherung anschließend im Hauptthread. |
| `BTS_COMPACTION_WORKER` | `0` | NeDB-Datensätze im Worker serialisieren, unveränderte Zeilen wiederverwenden. |
| `BTS_COMPACTION_MODEL_READS` | `0` | Punktmeldungen lesen stabile Modellobjekte während reiner Kompaktierung, sofern keine früheren Schreib-/unbekannten Aufträge warten. |
| `BTS_PREPARATION_MODEL_READS` | `1` | Bedarf, automatische Kandidaten, Zulässigkeit und Aufrufabstände lesen geordnete Objektreferenzen statt vollständiger NeDB-Kopien. |
| `BTS_PREPARATION_CANDIDATES_LIGHT` | `1` | Automatische Kandidatenauswahl berechnet keine umfassenden UI-Diagnosen. |
| `BTS_SYNC_BATCH_WRITES` | `0` | Änderungen werden je zusammenhängender Sammlung als ein NeDB-Append gespeichert. |
| `BTS_SYNC_PREPARED_TOURNAMENT` | `1` | Nur geänderte Turnierzweige kopieren und einmal validieren, vor den Ressourcen-Locks; Einzel-Append mit normalen Indizes und Rollback. |
| `BTS_SYNC_PREPARED_MATCHES` | `1` | Geänderte Matchzweige vor den Sync-Locks vorbereiten; Punkt-/Historienzweige teilen und bei ersetztem Basisdatensatz normal neu berechnen. |
| `BTS_ADMIN_RESPONSE_BACKGROUND` | `1` | Übersicht in kurzen Abschnitten kopieren und JSON erzeugen; geordnete Antworten und Updates pro Verbindung. |
| `BTS_ADMIN_RESPONSE_PRIORITY` | `1` | Hintergrundarbeit pausiert während der Punktpersistierung bis zur Veröffentlichung; Spielende-Cleanup behält seine eigenen Locks. |
| `BTS_COMPACTION_STAGED` | `0` | Automatische Kompaktierung bereitet die Datei außerhalb des Executors vor; benötigt den Kompaktierungsworker. |

`BTS_PERF_RUN_LABEL` benennt einen Versuch. Das Admin-Turnierobjekt enthält ein
vorübergehendes `debug_offloading` mit Label, Prozesskennung und tatsächlichen
Schaltern. Der Testclient speichert dieses Profil im Bericht und markiert
Profilwechsel oder Serverneustarts als `mixed_server_profiles`. Das Profil wird
nicht in die Turnierdatenbank geschrieben.

## Zuständigkeiten und Reihenfolge

`client.js` verwaltet einen wiederverwendeten Worker je Operation mit einer
eigenen FIFO. Maximal 64 Aufträge warten, das Zeitlimit von 30 Sekunden umfasst
auch die Queue. Ein aktiver Timeout oder Worker-Abbruch verwirft den Worker;
spätere Aufträge verwenden einen neuen. Fehler werden an den jeweiligen
Aufrufer gegeben. Idle-Worker verhindern das Beenden des Node-Prozesses nicht.

Die Sync-Planung in `../btp_planner/` verwendet dieselben Integrationsfunktionen
wie der direkte Pfad. Beim ersten Auftrag wird der private Datenbestand
übertragen, danach nur ersetzte oder gelöschte NeDB-Dokumente. Bis zu 32 private
Sitzungen werden gehalten; Neustart oder Verdrängung löst eine neue vollständige
Übertragung aus. Externe Effects werden als Befehle gesammelt. Im Hauptthread
folgen Ressourcenauswahl, gezielte Locks, Versionsvalidierung, Rebase paralleler
Punkte, Apply mit Rollback und Veröffentlichung. Änderungen während der Planung,
Turnier-Reset, Verbindungsabbruch und geänderte Uhrkonfiguration werden geprüft.
Freilosverarbeitung bleibt Bestandteil der Planung. Eigene Planer-Callbacks
ohne explizit unterstützte Operation laufen weiterhin direkt.

Mit `BTS_SYNC_PLAN_PATCH_RETURN=1` überträgt `../btp_planner/changes.js` für
bestehende Datensätze nur geänderte oberste Felder und die unveränderte NeDB-
Änderungsanweisung. Neue Datensätze werden vollständig übertragen, Löschungen
behalten ihre IDs. Der Hauptthread rekonstruiert den geplanten Stand aus genau
dem Snapshot dieses Auftrags. Unveränderte Punkt-Historien bleiben dort; auch
Datumswerte und fehlende Eigenschaften werden erhalten. Rekonstruierte Objekte
teilen unveränderte Felder mit dem unveränderlichen Snapshot und werden ebenso
validiert und unter denselben Locks übernommen. Effects werden weiterhin
vollständig übertragen. Ein Worker-Neustart ändert diese Regeln nicht.

Die Worker-Timings nennen `return_format` (`documents` oder `patches`);
`incremental_worker_plan.phases.restore_ms` misst die Rekonstruktion zusätzlich
zur Worker-Rückgabe. `sync_plan` enthält beide Abschnitte. Das Ermitteln der
geänderten Felder im Worker kostet zusätzliche Zeit; die reine Zustellungszeit
allein beschreibt deshalb nicht den gesamten Gewinn.

Die Gerätequeue in `../device_info/` hält keinen zusätzlichen Thread. Ein Punkt
kann nach seiner Speicherung abgeschlossen werden, während Hostname und
Geräteeinstellungen noch warten. Batterie im WebSocket wird sofort aktualisiert.
Noch wartende aufeinanderfolgende Punkt-Metadaten desselben Geräts werden auf
den neuesten Stand zusammengefasst; laufende Arbeit und explizite
Geräteinfo-Anfragen behalten ihre Reihenfolge. Geschlossene Verbindungen werden
nicht nachträglich als online gemeldet. Optionale Fehler erscheinen als
`device_info:background_error`, ohne einen gespeicherten Punkt zurückzuweisen.
Die Statusanzeige kann deshalb später als die Punktbestätigung aktualisiert werden.

`../registration_xlsx/` kopiert den Upload in einen eigenen Transferpuffer.
Der Aufrufer behält seinen Buffer. Nach dem Lesen wird der Turnierstand erneut
geladen; ein Reset verhindert die Speicherung veralteter Importdaten.

`../compaction_worker/` hält NeDBs Executor während Snapshot, Serialisierung
und Dateischreiben besetzt. Andere Aufgaben derselben Sammlung können weiter
warten. Der Worker bekommt keinen Dateipfad; ausschließlich der Hauptthread
ruft NeDBs `crashSafeWriteFile` auf. Datumswerte, Reihenfolge und Indexzeilen
bleiben erhalten. Nur ersetzte Dokumente werden nach einer ersten vollständigen
Übertragung neu serialisiert. Speicher-DBs und nicht ausdrücklich zertifizierte
Serialisierungshooks verwenden den bisherigen NeDB-Pfad. Ein Fehler gibt die
Queue frei und wird dem Kompaktierungs-Callback gemeldet.

`BTS_COMPACTION_MODEL_READS=1` ist unabhängig vom Kompaktierungsworker. Während
einer tatsächlich laufenden NeDB-Kompaktierung können Spiel, Turnier und Feld
für Punktmeldungen unmittelbar als isolierte Kopie aus dem Modell gelesen
werden. Die Erkennung in `../database_read_barrier.js` beobachtet Aufgaben auch
ohne Timing-Logging. Der Read darf zuvor wartende reine NeDB-Reads oder
Kompaktierungen passieren, aber keine Schreibaufträge, Datenbank-Neuladen oder
unbekannte Aufgaben. Ein Diagnose-Name genügt nicht als Read-Nachweis.
Nicht beobachtete Queue-Aufträge und Stores mit TTL-Indizes behalten ebenfalls
den bisherigen Executor-Pfad; NeDB-Reads können abgelaufene Dokumente löschen.

Der Snapshot wird sofort erstellt, der Callback weiterhin asynchron geliefert.
Später eingereihte Writes ändern diese Kopie nicht. Das Dateischreiben behält
den Executor und sämtliche späteren Writes warten weiterhin darauf. Bei
Kompaktierung der Match-Sammlung kann somit der Read früher fertig sein, der
anschließende Punkt-Write aber weiterhin warten. Laufende Append-Persistierung
wird nie übersprungen. Dieser Schalter verkürzt keine Disk-I/O-Zeit und keine
Sync-Ressourcen-Locks.

`BTS_PREPARATION_MODEL_READS=1` ist der Standard und beschleunigt die Bedarfsprüfung in
`auto_execute_preparation_selections`. `../preparation_selection/status.js`
liest Spielstätten wie bisher nach Namen sortiert und anschließend Felder und
Spiele über unveränderliche Modell-Snapshots. Reihenfolge und Executor-Barrieren
bleiben erhalten; frühere Schreibvorgänge und Kompaktierung werden abgewartet.
Historien, Spielerdaten und Setups werden für diese reine Statusberechnung nicht
kopiert. Fehlende Modell-Anbindungen und TTL-Indizes verwenden die NeDB-Abfragen.
Es werden keine Objekte geändert oder zusätzliche Threads/Locks angelegt.
Automatische Kandidaten, die erneute Zulässigkeitsprüfung und die Suche nach dem
letzten Vorbereitungstimestamp verwenden ebenfalls geordnete Referenzen. Die
initiale Turnierabfrage kopiert keine Meldelisten mehr; ohne beteiligte Offizielle
entfällt die Standby-Turnierabfrage. Öffentliche Kandidatenantworten bleiben Kopien.

Ohne den zusätzlichen Kandidaten-Schalter behalten Auswahl und Ausführung ihre bisherigen Daten,
Prüfungen, Offiziellenzuordnungen und Aufrufabstände. Insbesondere wird die
Freilosverarbeitung im Sync nicht verändert. `selection_reads.js` misst die
Auswahl-Reads und nennt deren Quelle; `timing.js` trennt Reads, synchrone Berechnungen,
Selbstblockierungsauflösung und Ausführung in einem kompakten Protokoll.

Isolierter Vergleich ohne Serverstart und ohne echte Turnierdaten:

```bash
node debug/preparation_reads_benchmark.js
```

519 synthetische Spiele, 13 Felder, 180 Historieneinträge je Spiel; beide
Varianten prüfen identischen ausreichenden Vorbereitungsbestand. Je drei
Warmups und 20 Messungen in wechselnder Reihenfolge. Dieser Vergleich misst
die Vorprüfung im Speicher, keine TV-Latenz oder vollständige Aufrufdauer.

## Drei weitere Schritte für die Bedienlatenz

`BTS_PREPARATION_CANDIDATES_LIGHT=1` betrifft ausschließlich automatische Aufrufe.
Die eigentlichen Kandidaten, Reihenfolge, Vorbereitungskapazität und sämtliche
Spieler-/Offiziellenregeln werden wie bisher berechnet. Die große Liste von
Anzeige- und Feld-Diagnosen wird ausgelassen. Wenn kein Spiel gewählt werden
kann, bleibt die Diagnose des bisherigen Frontiers für die Auflösung eines
blockierenden wartenden Tablet-Offiziellen erhalten. UI-/Admin-Abfragen liefern
weiter sämtliche Diagnosen. `preparation:timing` nennt bei `candidate_calculation`
das Feld `automatic_only`; Freilosverarbeitung und Aufrufabstände bleiben erhalten.

`BTS_SYNC_BATCH_WRITES=1` bündelt zusammenhängende Änderungen je Sammlung in
`../btp_planner/batch_writes.js`. Die Änderungen verwenden weiterhin NeDBs
Dokumentprüfung, Modifier und Index-Hooks für die kanonischen Objekte. Spätere
Reads/Writes warten auf einen gemeinsamen Append statt auf einen Append pro
Objekt. Löschen vor Schreiben, Ressourcen-Locks, Versionsprüfung und Punkt-Rebase
bleiben erhalten. Bei Fehlern werden die Indexstände zurückgesetzt; nach einem
fehlgeschlagenen Append werden auch die Vorherstände angehängt, um einen möglichen
Teil-Append zu korrigieren. Ein fehlgeschlagener Rollback wird ausdrücklich
gemeldet. Eigene Adapter, überschriebene Writer und TTL-Indizes verwenden die
bisherigen Einzel-Writes. `incremental_writes` nennt `batch_groups`,
`batch_changes` und `individual_writes`; Rollbacks liegen außerhalb dieser
Erfolgsmessung. Erst nach dem Persistieren werden Effects veröffentlicht.

`BTS_COMPACTION_STAGED=1` gilt für automatische Wartung nach dem Laden der
Datenbank. Ein kurzer Executor-Auftrag erfasst unveränderliche Dokumentreferenzen.
Der Worker serialisiert den Snapshot, und NeDB schreibt eine eigene Staging-Datei
`<Sammlung>.bts-compacting`. Währenddessen bleiben gewöhnliche Reads und Writes
frei; die originale Datei bleibt maßgeblich. Erfolgreiche zwischenzeitliche
Appends einschließlich Löschungen und Indexänderungen werden in Reihenfolge
nachgezogen. Große Journale werden ebenfalls außerhalb des Executors serialisiert.
Nur der Abschluss wartet im Executor: Restjournal anhängen, Staging-Datei fsyncen,
atomar umbenennen, Verzeichnis fsyncen. Punkte können auf diesen letzten Abschnitt
weiterhin warten; das Verfahren verspricht keine vollständig sperrfreien Writes.

Die Restserialisierung ist auf acht Journal-Dokumente begrenzt; nach drei
Nachziehversuchen wird eine überlastete Runde abgebrochen. Mehr als 1024
wartende Journal-Dokumente, fehlgeschlagene Appends und eine zwischenzeitliche
manuelle Neuschreibung verwerfen die alte Vorbereitung. Der normale Wartungstakt
setzt danach fort. Startup, manuelle Kompaktierung, Speicher-DBs, TTL und
nicht zertifizierte Codecs behalten den bisherigen Pfad. Auch direkt schreibende
Indexoperationen warten während des Tauschs. Staging-Dateien werden nie als
Datenbank geladen und werden beim nächsten Versuch überschrieben. NeDBs eigene
`filename~`-Recovery bleibt unverändert. Prozessabbruch vor/nach dem Tausch,
I/O-Fehler, parallele Punkte, Sync-Batches und Indexänderungen werden mit echten
temporären Dateien getestet.

`offload:task` mit Operation `compaction_staged` trennt `snapshot_encode_ms`,
`stage_write_ms`, `commit_queue_wait_ms` und `commit_locked_ms`; reale Zeitgrenzen
`commit_start_ts`/`commit_end_ts` ermöglichen die Zuordnung wartender Punkte.
Vorbereitungs- und Sync-Timings bleiben separat. Der gemeinsame Live-Lauf misst
die kombinierte TV-Wirkung; daraus lassen sich keine drei unabhängigen
TV-Latenzgewinne berechnen.

Isolierter Vergleich aller drei Schritte, ausschließlich synthetische Daten und
temporäre Dateien, ohne Serverstart oder echte Turnierdaten:

```bash
node debug/responsiveness_benchmark.js
```

Er prüft identische Kandidaten, 46 Änderungen mit 46 gegenüber einem Append und
Punkt-Writes während Kompaktierung. Endstände einschließlich Historien werden
erneut eingelesen. Das ist keine Messung der TV-Latenz im Turnier.

## Messung

`BTS_OFFLOAD_TIMING=1`, `BTS_BTP_SYNC_TIMING=1` oder `BTS_SCORE_PRESS_TIMING=1`
aktiviert `[bts] offload:task`. Jeder Datensatz enthält Operation, Ausführung,
reale Zeitgrenzen, monotone Dauer, Ergebnis, Timer-Verspätung und das Profil
beim Start. Worker-Aufträge zeigen getrennt Queue, Dispatch, Eingangswartezeit,
Worker-Laufzeit und Rückgabe. Rückgabe umfasst Klonen, Zustellung und Scheduling;
sie ist keine isolierte CPU-Zeit. Worker-Zeitgrenzen sind keine Hauptthread-Blockade.

`sync_plan` umfasst Refresh, Integration und Diff; `sync_plan_worker` ist darin
enthalten. `compaction` umfasst Serialisierung und Dateischreiben;
`compaction_serialize` ist darin enthalten. Diese Zeiten dürfen nicht addiert
werden. Geräteinfos zeigen Queue und Arbeitszeit unabhängig vom Punktabschluss.
Die 20-ms-Timer-Messung beschreibt verzögerte Hauptthread-Timer während der
Operation; gleichzeitig laufende Aufgaben können die Ursache sein.

Der Offline-Vergleich ist reproduzierbar und verwendet ausschließlich
synthetische Eingaben, Speicher-DBs und Worker:

```bash
npm run --silent debug:offload-benchmark > /tmp/bts-other-offloads-benchmark.json 2> /tmp/bts-other-offloads-benchmark.err
```

Gleichwertig direkt:

```bash
node debug/offload_benchmark.js > /tmp/bts-other-offloads-benchmark.json 2> /tmp/bts-other-offloads-benchmark.err
```

Acht abwechselnde Messpaare je Variante prüfen gleiche Ergebnisse außerhalb
des Messintervalls. Ein 2-ms-Timer beobachtet Reaktionsfähigkeit. Worker-Erstaufrufe
werden separat ausgewiesen. Bei Geräteinfos sind Punktabschluss und Abschluss
der Metadaten getrennt, mit künstlicher 100-ms-Hostname-Wartezeit. Kompaktierung
misst Serialisierung und Transport einschließlich Zeilencache, ohne Datei-I/O.
Die Ergebnisse ersetzen keine Tablet-/TV-Messung im laufenden Turnier.

Ein eigener Offline-Vergleich der Planungsrückgabe:

```bash
node debug/planner_return_benchmark.js > /tmp/bts-planner-return-benchmark.json
```

Er vergleicht 30 abwechselnde Messpaare mit 519 synthetischen Spielen, 36
geänderten Profilen und 180 Punkt-Einträgen je Spiel. Er enthält Ermitteln der
Rückgabefelder, Transport und Rekonstruktion, aber keine Integration, Effects,
DB-Schreibvorgänge oder Live-Locks. Ergebnisgleichheit wird außerhalb des
Messintervalls geprüft. Größenangaben sind JSON-Schätzungen, keine Messung des
internen Structured-Clone-Formats.

Der erste archivierte Vergleich (`independent_background_offloads` in
`../../debug/performance_runs.json`, acht Paare) ergab folgende Mediane nach
Worker-Warmup:

| Operation | Gesamtdauer direkt → Variante | Maximale Timer-Verspätung je Auftrag, Median |
| --- | --- | --- |
| Sync-Planung, 519 Spiele / 30 geänderte Spielerprofile | 61,5 → 67,2 ms | 18,6 → 1,6 ms |
| Kompaktierungsserialisierung, 93.420 Presses / ein geändertes Dokument | 161,1 → 22,6 ms | 161,0 → 0,5 ms |
| XLSX, 1.038 Zeilen | 29,6 → 33,4 ms | 28,1 → 1,6 ms |

Bei künstlich verzögertem Hostnamen sank der Median der Punktbestätigung von
101,2 auf 1,8 ms; Metadaten waren weiterhin erst nach rund 101 ms fertig.
Erstaufrufe inklusive Workerstart und vollständigem Snapshot dauerten bei
Planung 588,9, Kompaktierung 322,4 und XLSX 251,6 ms. Der Zeilencache erklärt
einen Teil des Kompaktierungsgewinns. Planung und XLSX zeigen hier eine bessere
Reaktionsfähigkeit bei etwas längerer Gesamtdauer. 591 Tests bestehen sowohl
mit Standardkonfiguration als auch mit allen vier neuen Schaltern aktiv.

## Vorbereitete Writes und Admin-Antworten

`../btp_planner/prepared_tournament.js` kopiert bei unterstützten `$set`/`$unset`-
Änderungen nur betroffene Elternobjekte und neue Werte. Unveränderte, bereits
validierte NeDB-Revisionen bleiben unverändert und werden geteilt. Arrays werden
bei der Prüfung neuer Werte einmal besucht, statt wie bei NeDB mehrfach.
Unsupported Modifier, überlappende Pfade, Array-Pfade, Identitätsänderungen und
besondere Datentypen fallen auf NeDB zurück. Custom Writer, TTL und automatische
Zeitstempel verwenden ebenfalls den bisherigen Einzel-Write. Bei inzwischen
geänderter Ausgangsrevision wird die Änderung erneut auf dem aktuellen Dokument
berechnet. Die Timing-Zeilen nennen Vorbereitung, tatsächlich verwendete Writes
und Rückfälle getrennt. Batch-Writes sind dafür nicht erforderlich.

Ein Append und die bisherigen Index-/Objektmodell-Hooks bleiben erhalten. Bei
fehlgeschlagener Persistierung werden Vorzustände zur Reparatur angehängt; die
ursprünglichen Profilrevisionen des Registrierungsbesitzers werden wiederhergestellt.
Neuere Profile aus parallelen Match-Writes behalten ihren Vorrang.

`../admin_response/` enthält Encoder und Ausgangsqueue. Eine Admin-Abfrage
reserviert ihre Position vor dem Lesen. Nachfolgende Updates auf derselben
Verbindung folgen auf die Übersicht und können sie nicht mit einer älteren
Antwort überschreiben. Andere Verbindungen bleiben unabhängig. Der Match-Reader
hält nur die Referenzaufnahme hinter früheren Writes im Executor; anschließend
kopiert er unveränderliche Revisionen außerhalb des Executors in kurzen Abschnitten.
Das JSON bleibt gleich, einschließlich Datumswerten, UTF8 und ausgelassener Historie.
Die Abschnitte zielen auf 2 ms; ein einzelner großer Wert ist nicht unterbrechbar.

`../foreground_work.js` verfolgt laufende Punktaufgaben ohne neue Locks. Hintergrund-
Kopieren und -Encoding pausieren bis zum gespeicherten/veröffentlichten Punkt.
Der Zähler wird auch bei Fehlern freigegeben. Nachgelagerte Spielende-Bereinigung
hält diese Priorität nicht weiter. Bei dauernder Punktlast kann das komplette
Neuladen länger dauern; kleine Antworten und andere Verbindungen bleiben frei.

Zum Vergleich ist `BTS_ADMIN_RESPONSE_ENCODER=worker` wählbar. Standard ist
`cooperative`; das Profil meldet die Worker-Wahl als `admin_response_worker`.
Der Worker verlängerte die Admin-Antwort auf der 519-Spiele-Kopie um rund
40–50 ms und bleibt deshalb aus. Er verarbeitet nur Antwortkopien, keine DB-Writes.
Bei Encoderfehlern fällt die Ausgabe auf die normale JSON-Erzeugung zurück.

Der neue Sequenzstandard `combined-responsive-background-admin` aktiviert
vorbereitete Writes, kooperative Admin-Antwort und Punktpriorität mit den bisherigen
Responsiveness-Schaltern; `BTS_SYNC_BATCH_WRITES=0`. Alle früheren Profile
setzen die neuen Schalter explizit zurück, einschließlich vererbter Shell-Werte.
`combined-responsive-prepared-writes` isoliert den ersten Schritt,
`combined-responsive-cooperative-admin` ergänzt Kopieren/Encoding ohne Punktpriorität.
Messungen und Grenzen: [isolierter Vergleich](../../debug/performance_isolated_sync_2026-10-11.md).
