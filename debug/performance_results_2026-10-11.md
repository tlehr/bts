# Messergebnisse vom 11. Oktober 2026

BTS-Optimierungen und Folgearbeiten liegen lokal auf `perf/server-responsiveness`.
Der eigenstaendige Client liegt unter `../bts-testclient`, Branch `main`.
Die [JSON-Zusammenfassung](performance_results_2026-10-11.json) enthaelt volle
Commit-IDs, Datenfingerprints, Phasen, Payloadzahlen und die Messgrenzen.
Es werden keine Turnierrohdaten oder Zugangsdaten eingecheckt.

## Empfangsvergleich

Je zehn Minuten, derselbe eingefrorene Anfangszustand mit 519 Spielen
(davon 300 bereits beendet), 13 aktiven Feldern, Seed 519. Beide Laeufe
beginnen mit demselben Daten- und Zustandsfingerprint. Externe BTP-Syncs und
Ticker sind nur in den isolierten Kopien ausgeschaltet. Messende ist das
WebSocket-Event im Simulator, vor JSON-Parse.

| Empfang | Serverstand | Zuordnung | Median ms | p95 ms | p99 ms | Max ms |
| --- | --- | --- | --- | --- | --- | --- |
| Tablet -> TV | Alt cf73f0a | 1170/1170 | 167 | 514 | 654 | 1098 |
| Tablet -> TV | Optimiert 647e479 | 1208/1208 | 7 | 38 | 115 | 243 |
| Tablet -> Admin | Alt cf73f0a | 1170/1170 | 11 | 215 | 469 | 675 |
| Tablet -> Admin | Optimiert 647e479 | 1208/1208 | 4 | 25 | 75 | 182 |

Dies zeigt die gemessene Empfangsleistung dieses Ausgangszustands. Es ist
kein Nachweis fuer ein vollstaendig durchgespieltes Turnier, Rendering,
akustische Ausgabe oder Last durch parallele externe Syncs. Die Tests liefen
nacheinander auf demselben Host; zeitweise lief weitere Verifikation parallel.
Die Server schreiten unterschiedlich schnell voran, sodass derselbe Seed
keine identische Anzahl von Aktionen erzwingt.

Der erste alte Lauf ist fuer TV-Latenzen verworfen: der alte Server ignoriert
mitgeschickte TV-IDs und verwendet die Quell-IP. Ohne getrennte lokale Adressen
wurden nur 96/1175 Updates zugeordnet. Dies war ein Testaufbaufehler. Nur dieser
ungueltige Lauf wurde wiederholt; die gueltige optimierte Langzeitmessung bleibt
erhalten. Der Runner verwendet jetzt getrennte Loopback-Adressen fuer TV und
Tablet auf beiden Seiten, ohne den alten Server zu veraendern.

Ein zusaetzlicher 30-Sekunden-Vergleich des alten und aktuellen Stands
`fe2a7df` erfasste jeweils alle 70 Updates bei TV und Admin. Beim aktuellen Stand:
TV Median 8 ms / p95 44 ms, Admin Median 4 ms / p95 41 ms. Diese Kurzpruefung
ersetzt keinen Langzeitvergleich der juengsten Aenderungen.

## Isolierte Admin-Optimierung

Zwoelf alternierende Paare mit gleichen Daten, vollstaendigen Historien und
identischen Hintergrund-/Prioritaetseinstellungen. Nur
`BTS_ADMIN_MATCH_REVISION_CACHE` variiert. Produktionshandler und Outbox bis
`ws.send`; Antwortinhalte strukturell gleich (Diagnoseprofil ausgeschlossen).

| Snapshot | Ohne Cache Median / p95 ms | Mit Cache Median / p95 ms |
| --- | --- | --- |
| Kalt | 132,4 / 212,3 | 90,5 / 155,0 |
| Warm | 137,8 / 161,4 | 64,1 / 77,5 |

Der Cache vermindert das Kopieren/Kodieren unveraenderter Spielrevisionen.
Diese Messung enthaelt weder Netzwerk noch gleichzeitige Punkte-/Renderinglast
und belegt daher keine gleich grosse Verbesserung der TV-Latenz.

## Verifikation und verbleibende Vergleiche

746 BTS-Tests aus sauberem Checkout; 23 unabhaengige Clienttests auch nach
frischem Klonen, festgeschriebenem BUP-Submodul und eigenem `npm ci`;
Client-ESLint und 22 Chromepruefungen des Dashboards bestanden. Zusaetzlich
18 gezielte BTS-/Client-Integrationstests nach der IP-Korrektur bestanden.
Die Originalberichte liegen weiterhin lokal unter `/tmp/bts-reference-*`.

Der ergaenzende [BTP-/Aufrufvergleich](performance_queue_2026-10-11.md) belegt
in isolierten alten und aktuellen Servern die beseitigte Blockierung beim
BTP-Warten und bei unveraenderten Daten sowie verbleibende Zuweisungs-Locks
bei grossen Aenderungen. Historische Queue-Daten des obigen Live-Laufs fehlen
weiterhin und werden nicht als Null-Wartezeit dargestellt.
Ein Langzeitlauf des letzten Stands bleibt eine sinnvolle separate Messung.
Remote/Push ist bislang nicht eingerichtet bzw. ausgefuehrt.
