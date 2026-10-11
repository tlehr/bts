# BTP-Sync und Blockierung von Spielaufrufen, 11. Oktober 2026

Die alte globale Queue blockiert den Spielaufruf während des BTP-Wartens und
bei unveränderten Sync-Daten. Diese beiden Blockierungen sind im aktuellen
Stand beseitigt. Ein großer Änderungs-Sync blockiert den Aufruf eines
unveränderten Spiels weiterhin über gemeinsame Zuweisungs-Locks und war
in diesem Test sogar langsamer. Eine pauschale Aussage „Syncs blockieren
Aufrufe nicht mehr“ ist deshalb nicht durch die Messung gedeckt.

Verglichen wurden `cf73f0a731dd26aac4fb360a71b5d2b165deef0f` und
`c41f71d`, jeweils drei Wiederholungen mit alternierender Reihenfolge auf
demselben Host. Pro Fall frische synthetische BTP-Daten: 519 Spiele,
1.038 unterschiedliche Spieler, 13 Felder, persistente NeDB. Der große Sync
ändert die Spielnummern von 518 Spielen; das aufgerufene Spiel und seine Spieler
bleiben unverändert. Einzelwrites sind in diesem Serverstand Standard;
gebündelte Sync-Writes sind ausgeschaltet.

Gemessen wird das echte Aufruf-Event am separaten WebSocket-Empfänger,
ausgelöst durch `match_call_on_court` mit tatsächlicher Feldvergabe.

| Szenario | Aufruf alt Median / Max ms | Aufruf aktuell Median / Max ms | Queue-Warten alt / aktuell Median ms |
| --- | ---: | ---: | ---: |
| Ohne Sync, Kontrolle | 10,9 / 13,7 | 16,6 / 19,3 | 0,3 / 0,3 |
| BTP antwortet erst nach 2 Sekunden | 2.014,7 / 2.015,9 | 16,0 / 22,6 | 1.997,1 / 0,2 |
| 518 Spiele ändern sich | 236,7 / 248,8 | 276,2 / 343,4 | 224,6 / 262,4 |
| BTP-Daten unverändert | 304,9 / 321,8 | 27,2 / 28,1 | 284,8 / 0,3 |

Alle 24 Fälle lieferten beide erwarteten Events und Antworten. Alle beobachteten
Scheduler- und DB-Aufgaben endeten; die Queues waren nach jedem Fall leer.
Bei allen 18 Sync-Fällen wurden die Probe gesendet und der Aufruf eingereiht,
bevor der Root-Sync endete. Alle sechs großen Syncs integrierten genau 518
Änderungen. Die zusätzlich angeforderte freie Durchsage kam in sämtlichen
Fällen innerhalb von 7,5 ms an. Dieser Handler umgeht bereits im alten Stand
die globale Queue; er bestätigt keine Verbesserung einer früheren FIFO-Sperre.

Zwei kurze Wiederholungen des großen aktuellen Syncs erfassen den konkreten
Blocker: `fetch_sync_apply` hält `auto-call:default`, `preparation:default`,
`tabletoperators:default` und `umpires:default`. Der Spielaufruf benötigt dieselben
Ressourcen und wartet 261 beziehungsweise 274 ms. Die Match- und Feld-Locks des
unveränderten Spiels sind in diesem Fall nicht der Konflikt. Der letzte
beobachtete Blocker erklärt einen realen Konflikt, jedoch nicht millisekundengenau
die gesamte Wartezeit. In den drei Hauptmessungen sind jeweils 518 einzelne
Match-Updates während der Integration beobachtet worden. Der Root-Sync dauert
aktuell im Median 851 statt 522 ms; darin steckt auch Planung vor den Locks.

Nächster sinnvoller Serverpunkt: prüfen, ob reine lokale Metadatenänderungen
wie Spielnummern die vier gemeinsamen Zuweisungs-Locks wirklich benötigen.
Das derzeitige `bts/btp_sync_locks/resources.js` nimmt sie bei jeder Match-Arbeit.
Eine Eingrenzung braucht eine geprüfte Änderungsklassifikation und muss die
Validierung bei parallelem Aufruf erhalten. Abhängigkeiten, Profil-/Spieler-
Änderungen, Offiziellenvergabe, Check-in, Spielende und Freilosweitergabe müssen
ihre notwendigen Sperren behalten. Erst mit Regressionen und demselben gezielten
Vergleich entscheiden, ob die Änderung die Benutzerlatenz verbessert.

Die [JSON-Auswertung](performance_queue_2026-10-11.json) enthält Einzelwerte,
volle Referenz-SHAs, Fingerprints, Messimplementierungs-Hashes und die
konfliktierenden Locks. Vollständige Diagnosen des Hauptvergleichs:
`/tmp/bts-queue-responsiveness-JrM38x`; Blocker-Nachmessung:
`/tmp/bts-queue-responsiveness-zT1JvV`. Die während der Hauptmessung verwendete
Messimplementierung wurde vor den späteren Ergänzungen separat archiviert.
Start und Messpunkte stehen in [queue_responsiveness.md](queue_responsiveness.md).

Grenzen: kontrollierter BTP-Callback statt realem Transport/XML-Decoder,
synthetische unabhängige Spiele statt fortschreitendem Turnier, keine normale
Timerlast und keine parallelen Tablet-Punkte. Parser, Integration, Persistenz,
Feldvergabe und Empfang laufen tatsächlich. Drei Wiederholungen sind keine
Langzeitverteilung. Es wurde kein akustischer Start gemessen. Das Leeren nach
Einzelproben zeigt keinen bleibenden Rückstau dieser Fälle; es beweist nicht,
dass sich unter dauerhaft höherer Last niemals eine Queue aufbaut.

Verifikation der fertigen Messimplementierung: 37 gezielte Tests zu Fixture,
CLI, sicheren Archivpfaden, erhaltenen Batch-Zertifikaten, Lock-Blockern,
Prozessabbruch, Scheduler und Fetch-Pipeline; ESLint bestanden. Acht kurze
Kontrollfälle mit 12 Spielen auf beiden Ständen und eine abschließende Prüfung
des Archivschutzes bestanden. Der große Vergleich wurde dafür nicht wiederholt.
