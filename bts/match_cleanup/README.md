# Bereinigung beim Spielende

`finish.js` liest Match und Turniereinstellungen einmal in der Reihenfolge der
Datenbankoperationen. Die Match-Projektion enthält Setup und Ergebnis, aber keine
Punktehistorie; die Turnier-Projektion lässt das Disziplinpaket `events` aus.

| Datei | Aufgabe |
| --- | --- |
| `reads.js` | Geordnete, gezielte Lesezugriffe und Kompatibilität mit einfachen Test-Datenbanken |
| `players.js` | Spieler- und Tabletflags in zugeordneten Matches, Pausen und Feldfreigabe |
| `participant_writes.js` | Höchstens vier Teilnehmeränderungen je geordnetem Append, mit Rollback und nativem Fallback |
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

Wiederholte Abschlüsse desselben Matches laufen nacheinander. Nach dem Einreihen
der Verlierer hält `tabletoperator_finish_ts` fest, dass der Tabletbedarf dieses
Spieldurchlaufs bereits behandelt wurde. Eine korrigierte Endzeit erzeugt keinen
weiteren Dienst. Eine ausdrückliche Reaktivierung oder Ergebnisrücknahme in BTP
entfernt die Kennung, damit ein wirklich erneut gespieltes Match neu eingereiht
werden kann. BTP-Ergebnisse werden vor der Bereinigung gespeichert; ein
entferntes Ergebnis gilt auch nach einem Sieg von Team 2 nicht als neuer Abschluss.

Eine automatische Tabletzuweisung speichert das bediente Match unter
`assigned_match_id`; `match_id` bleibt das Herkunftsspiel. Beim Abschluss werden
nur die Dienste dieses Matches beendet. Für ältere Einträge ohne Einsatzkennung
wird die aktuelle Feldbelegung geprüft. Spielerflags einer bereits laufenden
Folgezuweisung bleiben auch dann erhalten, wenn diese dasselbe Feld verwendet.

Teilnehmeränderungen werden in Gruppen von höchstens vier Matches gespeichert.
Zwischen den Gruppen können bereits wartende Punkte und Reads anderer Felder
laufen. Die vorbereiteten Änderungen entstehen gegen den aktuellen Datensatz im
Executor; nur geänderte Objekt- und dichte Arrayzweige werden kopiert. Unveränderte
Punktehistorien werden geteilt. Ein fehlgeschlagener Append stellt seine Gruppe
auch auf der Platte wieder her; erfolgreiche frühere Gruppen sind bereits gemeldet.
Bei angepassten Datastore-Writern, Zeitstempeln und TTL bleibt der native Weg
bestehen. TTL-Indizes werden auch nach dem Einreihen erneut berücksichtigt.
