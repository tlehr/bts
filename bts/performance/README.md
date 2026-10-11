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

Vollstaendige Admin-Antworten verwenden intern die hinter der Persistenzbarriere
eingefangenen unveraenderlichen NeDB-Revisionen. Dadurch bleibt das Kopieren
langer Spielhistorien ausserhalb des DB-Executors. Der kooperative Encoder
merkt sich JSON je unveraenderlicher Spielrevision in WeakMaps; geaenderte
Spiele bekommen einen neuen Cache-Eintrag, alte Revisionen bleiben fuer bereits
begonnene Antworten gueltig. Gewoehnliche programmatische `read_matches`-Aufrufe
liefern weiterhin veraenderbare, isolierte Kopien. Reihenfolge von Antwort und
folgenden Changes wird weiterhin durch die Admin-Outbox garantiert.

`BTS_ADMIN_MATCH_REVISION_CACHE=0` deaktiviert diese neue Optimierung fuer einen
isolierten Vergleich. Alte Benchmarkprofile setzen diese Option explizit aus;
das neue Profil `combined-responsive-cached-admin` aktiviert sie. Die Diagnose
liefert kumulative Cache-Hits/Misses, keine behauptete Anzahl noch lebender
Cache-Eintraege. `node debug/admin_snapshot_benchmark.js DATA` vergleicht nur
diese Optimierung bei identischen Daten und vollstaendigen Historien. Zwoelf
abwechselnde Paare auf der 519-Spiele-Kopie vom 11. Oktober 2026 ergaben Median
137,8 -> 64,1 ms fuer den zweiten unveraenderten Abruf und 132,4 -> 90,5 ms
fuer den ersten. Inhaltliche Antwortgleichheit wurde geprueft; Ende der Messung
ist `ws.send`, ohne Netzwerk/Rendering oder gleichzeitig eintreffende Punkte.
