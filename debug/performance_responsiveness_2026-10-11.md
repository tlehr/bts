# Live-Vergleich vom 11.10.2026: drei Optimierungen

Der neue zehnminuetige Lauf war fehlerfrei, zeigt aber insgesamt schlechtere
TV-Latenzen als die bereits vorhandene Referenz. Die automatische Auswahl und
die Sperrdauer der Match-Kompaktierung verbessern sich deutlich. Fuer die
gebuendelten Sync-Writes ist in diesem Lauf kein Zeitgewinn nachgewiesen.

Referenz: `benchmark_519_after_preparation_model_reads`, 11.10.2026,
01:43–01:53 Uhr Europe/Berlin. Neu: `benchmark_519_after_three_responsiveness_optimizations`,
02:16–02:26 Uhr. Quelle: `/tmp/bts-offload-sequence-XF35Vs`;
vollstaendige Auswertung `analysis.json`, Vergleich `comparison.json` und
dauerhaft `debug/performance_runs.json`. Die Referenz wurde nicht wiederholt.

| Messung | Referenz | Neu |
| --- | ---: | ---: |
| Erfolgreiche Tablet-Meldungen | 1178 | 1179 |
| Davon Punkte / Spielende-Bestaetigungen | 1164 / 14 | 1165 / 14 |
| TV-Zuordnung | 100 % | 100 % |
| TV-Mittelwert | 11,8 ms | 16,5 ms |
| TV-Median | 8 ms | 9 ms |
| TV-p95 | 29 ms | 73 ms |
| TV-p99 | 115 ms | 115 ms |
| TV-Maximum | 189 ms | 185 ms |
| TV-Meldungen ueber 50 ms | 33 | 94 |
| TV-Meldungen ueber 100 ms | 18 | 23 |
| TV-Meldungen ueber 200 ms | 0 | 0 |
| Score-Handler p95 | 16,3 ms | 24,7 ms |
| Score-Handler Maximum | 184,8 ms | 151,7 ms |
| Score-Ressourcenqueue Maximum | 133,1 ms | 68,7 ms |

Globalwerte stammen aus den gemessenen TV-Stichproben, nicht aus gemittelten
Phasen-Quantilen. Langsame Einzelmeldungen werden jetzt ab einschliesslich
100 ms geloggt: 24 Logzeilen, davon 23 strikt ueber 100 ms.

Die Verschlechterung konzentriert sich auf die ersten zwei Minuten:

| Phase | TV-p95 vorher / neu | TV-p99 vorher / neu | Ueber 100 ms vorher / neu |
| --- | ---: | ---: | ---: |
| Erste zwei Minuten | 39 / 106 ms | 130 / 149 ms | 4 / 20 |
| Vier Minuten Last | 23 / 30 ms | 114 / 82 ms | 9 / 2 |
| Zwei Minuten nach Leerlauf | 31 / 32 ms | 113 / 57 ms | 5 / 1 |

Die Leerlaufphase hat keine Punktmeldungen. Die ersten zwei Minuten gehoeren
zur Bewertung: Die zehn Sekunden Aufwaermphase liegen bereits davor.

## Wirkung der drei Aenderungen

**Automatische Kandidatenauswahl:** Median der synchronen Berechnung
65,1 auf 17,2 ms; Maximum 75,6 auf 26 ms. Alle 15 neuen Auswahlberechnungen
nutzen `automatic_only`. Gesamte Vorbereitungsjobs mit echter Auswahl:
Median 146 auf 96,1 ms. 85 weitere Jobs finden bereits genug Vorbereitung.
Keine Vorbereitungsfehler. `process_cpu_ms` umfasst auch Worker; die
synchron gemessene Dauer zeigt die Belegung des Hauptthreads, einschliesslich
GC und Scheduling. Andere Turnierdaten begrenzen die kausale Zuordnung.

**Sync-Batches:** 388 Aenderungen in 26 Gruppen; ein auditierter
Tabletoperator-Write verwendet korrekt den Einzelpfad. Alle 17 BTP-Commits
erfolgreich. Write-Median trotzdem 29 auf 63 ms; Mittelwert praktisch gleich
(51,5 auf 51,8 ms), Maximum 166 auf 160 ms. Apply-Median 38,5 auf 86 ms,
Gesamtsync-Median 404,5 auf 548 ms. Drei Validierungs-Neuplanungen statt null;
geplante Punktdaten bzw. Vorbereitung-Nachfolgerflags hatten sich geaendert.
Weniger Appends allein beseitigen Kopier-/Serialisierungs-/Schedulingkosten
und die bestehenden Ressourcen- oder Collection-Barrieren nicht.

Ein Turnier-Batch belegt seinen Executor 121,3 ms, davon 89,2 ms innerhalb
`persistNewState`. Letztere Zeit enthaelt Serialisierung, Append und
Callback-Scheduling; sie ist keine isolierte Datentraegerzeit. Eine nach dem
Lauf nur gelesene Dateikopie zeigt einen Turnierdatensatz mit 447915 Bytes,
davon 443174 Bytes `events` (kompaktes UTF-8-JSON). Das ist nicht zwingend
der exakte Datensatz des langsamen Writes.

**Kompaktierung:** 13 erfolgreiche vorbereitete Dateitausche. Typische
Executor-Sperre rund 17 ms; Maximum 56,4 ms bei `normalizations`. Matches:
Gesamtdauer 295 ms, davon nur 16,9 ms im finalen gesperrten Commit. Vorher
belegte die Match-Kompaktierung den Executor etwa 188,4 ms. Die neue
Vorbereitung erfolgt ausserhalb des Executors; Gesamtdauern sind deshalb
nicht gleichbedeutend mit Sperrdauern.

Im neuen Lauf faellt kein Punkt-Sendezeitstempel in die Match-Kompaktierung.
Somit ist deren kuerzere Sperre belegt, ein unmittelbarer Live-Punktgewinn
durch diese Kompaktierung aber nicht gemessen. Alle 13 Journale bleiben leer;
gleichzeitige Appends, Nachziehen und Absturzsicherheit wurden in den vorherigen
isolierten Tests geprueft. Der finale Tausch bleibt eine kurze Sperre.

## Belegte Verzoegerungen

- Punkt-Trace `live-drill-1095025-mv32owxs-49`: TV 178 ms, Handler 151,7 ms,
  Ressourcenqueue nur 0,3 ms. Kontextlesen 147,2 ms, dabei Timer-Verzug 106,5 ms.
  Der vorherige Feld-Find dauert nur 2,7 ms; danach vergehen 124,3 ms zwischen
  seinem Callback und dem naechsten Modell-Read. Unabhaengige Match- und
  Umpire-Abfragen enden gleichzeitig mit rund 126 ms Dauer ohne Persistierung.
  Keine vorbereitete Kompaktierung ueberlappt. Das belegt einen gemeinsamen
  Scheduling-Stall; die verursachende Funktion, GC oder Betriebssystemlast
  ist noch nicht isoliert.
- Punkt 136 wartet 68,7 ms hinter Sync-Task 175 auf sein eigenes Match/Feld.
  Dieser Sync haelt die Ressourcen 121 ms, davon 92 ms Writes fuer 37
  Aenderungen. Dieser konkrete Lock-Konflikt ist belegt.
- Punkt 869 wartet 40 ms hinter Spielende-Bestaetigung 868 auf einem anderen
  Feld: Der Spielende-Pfad haelt auch `courts:default`. Das bleibt ein
  eigenstaendiger Kandidat fuer eine spaetere, sicherheitsgepruefte Eingrenzung.

Die Score-Messung beginnt am Handler-Eintritt. Client-Sendezeit plus
Handlerdauer ergibt keinen Server-Endzeitpunkt. Serverueberlappungen verwenden
die realen Start-/Endzeitstempel der Queue. Verschachtelte Dauern sind nicht
addierbar; zeitliche Ueberlappung beweist allein keine Ursache.

## Grenzen und naechster Vorschlag

Das Turnier laeuft weiter: 227 statt 213 fertige Matches am Start, 24 statt
32 Check-ins, 15 statt 22 echte Vorbereitungs-Auswahlen. Mittlere Feldbelegung
unter Hauptlast 12,3 statt 12,0. In den ersten zwei Minuten sechs statt drei
Spielende-Bestaetigungen. Alle neuen Schalter waren nachweislich aktiv, aber
ein gemeinsamer Lauf trennt deren einzelne TV-Auswirkungen nicht kausal.

Naechste Prioritaet: die langen Hauptthread-/Schedulingphasen bei Kontextlesen
und TV-Ausgabe identifizieren. Zunaechst mit einer isolierten Turnierkopie ein
begrenztes CPU-Profil und genaue Messungen fuer synchrones Kopieren,
Serialisieren und Veroeffentlichen erheben; volle Tablet-/Display-Refreshes
und GC einbeziehen. Danach gezielt schwere sichere Vorarbeit vor die Locks
verlagern oder identische Ausgabe wiederverwenden. Persistenz, Validierung,
Punkt-Rebase und Freilos-/Offiziellenregeln erhalten. Kein weiterer
zehnminuetiger Referenzlauf ist fuer diese Diagnose erforderlich.
