# Begrenzte Ablaufdiagnose

Der Recorder wird ausschliesslich durch die Diagnosefreigabe aktiviert. Die
Serverkonsole bleibt dabei still. Pro Vorgang werden hoechstens 160 Einzelschritte
behalten; schnelle DB-Schritte belegen anfangs hoechstens 80 davon. Weitere
DB-Schritte erscheinen in maximal 32 Zusammenfassungen mit Anzahl, Summe, Fehlern
und laengstem Einzelschritt. Langsame DB-Schritte werden bei freiem Platz einzeln
behalten. Spaete wichtige Phasen koennen abgeschlossene DB-Details verdraengen;
diese gehen dann ebenfalls in die Zusammenfassung. Schritt-IDs bleiben eindeutig.
Summen ueberlappender Schritte sind keine Gesamtdauer. Nicht zusammenfassbare
Schritte werden weiterhin explizit als ausgelassen gezaehlt.

Schrittstatistiken normalisieren interne DB-Lesenamen und haben ein eigenes
Budget je Vorgangstyp (96 Gruppen, insgesamt maximal 576). Punkt- oder Spielende-
Statistiken koennen dadurch nicht das Budget der Sync-Diagnose aufbrauchen.
Nicht aggregierte Messungen werden weiterhin ausgewiesen. Die Perzentile stammen
aus den letzten 256 Messungen der jeweiligen Gruppe.

DB-Wartezeiten enthalten beobachtete vorausgehende Aufgaben derselben Queue,
mit Queue-ID, Aufgabe, Ausloeser-ID (falls vorhanden), Laufphase und Persistenzart.
Auch ungetracete Hintergrundaufgaben sind so identifizierbar. Der letzte
beobachtete Blockierer beschreibt nicht zwingend die gesamte Wartezeit. Aktive
DB-Details und maximal 32 kuerzlich abgeschlossene Aufgaben pro DB werden waehrend
der Diagnose geliefert; Abfragefelder, Inhalte und Spielerangaben bleiben privat.
DB-Laufzeiten unterscheiden die Zeit bis zum Callback, dessen Verarbeitung und
die Persistenzdauer. Teilzeiten koennen ueberlappen und enthalten asynchrone
Wartezeit; sie sind keine CPU-Zeiten. Executor-Freigabeverzoegerungen werden in
den aktiven/letzten DB-Details angezeigt. Das additive Diagnoseprotokoll traegt
`protocol_version: 2`; alte Server koennen weiterhin auf Eventempfang getestet
werden (`--no-server-telemetry`).
