# Prüfung vor dem Feldaufruf nach dem Sync

`index.js` liest geordnete, unveränderliche Referenzen aus dem Turniermodell.
Ist kein aktives Feld frei, entfällt die isolierte Planung und die Resource-Queue.
Die Belegung berücksichtigt sowohl `court.match_id` als auch Matches mit
`setup.now_on_court` und `setup.court_id`.

Bei freien Feldern merkt sich der Planer nur nach einer erfolgreich validierten
Planung ohne Änderungen den geprüften Datenstand. `inputs.js` erkennt neue,
gelöschte und geänderte Datensätze, einschließlich Check-ins, Teilnehmern,
Feldzuweisungen, Offiziellen und Turniereinstellungen. Unveränderte Referenzen
benötigen keinen Wertevergleich. Laufende Punkte und die interne
`_btp_sync_signature` lösen allein keine neue Planung aus.

`deadlines.js` verwendet die Zeitgrenzen der bestehenden Aufrufregeln:
Vorbereitungsdauer, Zeitfenster vor dem angesetzten Start, Spielerpause und
Tablet-Pause sowie den Beginn eines wartenden Tabletbedieners. Sobald eine
Grenze erreicht ist oder die Uhr zurückspringt,
berechnet der nächste Feldaufruf einen neuen Plan. Bestehende periodische Aufrufe
bleiben aktiv; dieser Cache erzeugt keinen neuen Timer.

Tatsächliche Zuweisungen verwenden weiterhin die bestehende Planung,
Validierung und Resource-Locks. Der Cache hält den validierten Planungsstand
fest, damit Änderungen während des Abschlusses eines Durchlaufs sichtbar
bleiben. Fehlgeschlagene Planungen und tatsächliche Zuweisungen verwerfen ihn.

Mit `BTS_BTP_SYNC_TIMING=1` nennt `phase: "auto_call_precheck"` die Dauer und
gegebenenfalls `reason: "no_free_courts"` oder `"unchanged_call_inputs"` sowie
die nächste Zeitgrenze. Übersprungene Aufrufe benötigen keine Resource-Locks.
