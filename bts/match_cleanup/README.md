# Bereinigung beim Spielende

`finish.js` liest Match und Turniereinstellungen einmal in der Reihenfolge der
Datenbankoperationen. Die Match-Projektion enthält Setup und Ergebnis, aber keine
Punktehistorie; die Turnier-Projektion lässt das Disziplinpaket `events` aus.

| Datei | Aufgabe |
| --- | --- |
| `reads.js` | Geordnete, gezielte Lesezugriffe und Kompatibilität mit einfachen Test-Datenbanken |
| `players.js` | Spieler- und Tabletflags in zugeordneten Matches, Pausen und Feldfreigabe |
| `officials.js` | Aktuellen Offiziellen-Datensatz freigeben und andere Einsätze berücksichtigen |
| `finish.js` | Reihenfolge und einzelne Phasenmessungen |

Spieler und Tabletbediener werden über den Spieler-Match-Index ausgewählt.
Offizielle haben direkte, nach Rolle getrennte Rückverweise auf ihre Matches.
Schreibvorgänge ändern einzelne Teilnehmerfelder statt das ganze Setup zu
ersetzen. Dadurch bleiben parallel eintreffende Punkte und Vorbereitungsmarker
erhalten. Unveränderte Spieler- und Tabletflags werden nicht erneut geschrieben.
Die bisherige Reparatur bereits entblockter Spiele verwendet einen eigenen,
bei Matchänderungen aktualisierten Index.

Die Reihenfolge bleibt Spieler → Tabletbediener → Offizielle → Tabletwarteliste
→ BTP-Felder. Tabletbediener lesen ihre betroffenen Matches nach den
Spieleränderungen; die Warteliste bekommt den aktualisierten Stand des beendeten
Matches. Offiziellenprofile werden aus `umpires` gelesen, weil die Kopie im
Match älter sein kann. Aktive Einsätze auf anderen Feldern und geplante Rollen
bleiben erhalten. Die Offiziellenphase wartet auch bei Fehlern auf alle bereits
begonnenen Offiziellen-Schreibvorgänge.

Die Aufrufer halten weiterhin ihre Ressourcen-Locks. Die Bereinigung erwirbt
keine verschachtelten Locks; Folgeaufträge zur automatischen Zuweisung werden
eingereiht und laufen nach der Freigabe der bestehenden Locks.
