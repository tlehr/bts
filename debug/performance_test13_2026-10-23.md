# Test 13: Punktübertragung und Scheduling beim Speichern

Die Sprachverwaltung läuft im eigenen Prozess. Ihre gemessenen synchronen
Sammel- und Sendeschritte erklären die langen Punktübertragungen nicht. In
mehreren Spitzen entstehen erhebliche Verzögerungen vor dem Dateischreiben.
Der Speicherweg für BUP-v2-Punkte wird deshalb um zusätzliche Event-Loop-Durchläufe
verkürzt. Welche Arbeit den Hauptthread während der Live-Spitzen beschäftigt,
ist durch diesen Bericht noch nicht nachgewiesen.

## Gelieferter Lauf

`bts-test-13.json`: Beginn 23.10.2026, 18:25:07 UTC, Laufzeit 125.026 ms,
`stop_reason: interrupted`. Anfangs 128 Spiele, davon 46 beendet und 13 aktiv.

| Empfang | Mittel | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 23,3 ms | 73 ms | 116 ms | 143 ms | 33 | 303/303 |
| Admin | 30 ms | 78 ms | 122 ms | 151 ms | 49 | 303/303 |

Alle gesendeten Aktualisierungen wurden an beiden Empfängern zugeordnet. Das
Latenzziel ist weiterhin verfehlt. Wegen des Abbruchs wurde das Leerlaufen der
Queues nicht abschließend geprüft. Andere Anfangsdaten und die kurze Laufzeit
erlauben keinen kontrollierten Regressionsnachweis gegenüber Test 11.

Der letzte Sprachstatus meldet `execution: process`, einen laufenden Kindprozess
und null ausstehende Anfragen. Seine Sendestatistik ist kumulativ seit dem
Prozessstart, kein ausschließliches Testintervall. In den gelieferten,
nach Revision bereinigten Traces benötigen die synchronen Schritte maximal
2,5 ms für `speech_snapshot_collect` und 8,1 ms für `speech_bridge_send`.
Die gesamten Snapshot-/Antwortzeiten enthalten zusätzlich beabsichtigtes Warten
auf vorrangige Punkte. Gemeinsame Host-CPU und Datenträger sowie andere
Hauptthread-Arbeit werden durch diese Einzelmessungen nicht ausgeschlossen.

Die Event-Loop-Messung erreicht maximal 188,5 ms. Das ist eine Timermessung mit
20-ms-Auflösung, keine exklusive CPU-Zeit einer bestimmten Funktion.

## Verzögerungen vor dem Append

- Aktualisierung 268: 143/151 ms bis TV/Admin. Die Datenbank-Updatephase dauert
  82,5 ms. Zwischen Executor-Start und Aufruf des Append liegen rund 67 ms;
  das instrumentierte Append-/Callback-Warten selbst dauert 7,6 ms.
  Ein überlappender GC von 10,8 ms erklärt die gesamte Spitze nicht.
- Aktualisierung 27: 118/129 ms bis TV/Admin. Updatephase 59,3 ms, darin
  27,7 ms Queue-/Scheduling-Warten. Das instrumentierte Append-/Callback-Warten
  beträgt nur rund 0,5 ms. Es gibt keinen überlappenden aufgezeichneten GC.
- Aktualisierung 269 wartet beim Lesen rund 91 ms auf den vorangehenden Writer.
  Eine Verzögerung innerhalb eines Updates kann damit auch den nächsten Punkt
  eines anderen Spielfelds treffen.

`storage_wait_ms` enthält asynchrones I/O und Zustellung des Callbacks; auch
dies ist keine reine physische Plattenzeit. Die Wartezeiten identifizieren die
betroffene Strecke, aber noch keinen alleinigen Verursacher.

## Änderung

`bts/score_write.js` verarbeitet die bekannte Einzelspiel-Aktualisierung direkt
als einen NeDB-Executor-Auftrag. NeDBs allgemeines Update verwendet hier intern
mehrere `async.waterfall`-Stufen mit jeweils `setImmediate`. Bei belegtem
Hauptthread muss der Punkt zwischen diesen Stufen erneut warten.

Der direkte Auftrag verwendet weiterhin NeDBs Query-Prüfung, `model.modify`,
Dokumentvalidierung, Index- und Modell-Hooks, Persistenz und eine abgetrennte
Kopie für den Callback. Vorangehende und nachfolgende Executor-Aufträge bleiben
geordnet. Erst nach erfolgreichem Persistenz-Callback folgt die Punktverteilung.
Spielnummern und Sortierfelder werden durch den neuen Weg nicht geändert.
Die bestehende NeDB-Fehlerweitergabe bleibt erhalten.

Bei TTL, Zeitstempeln, nicht zertifizierten Datastores oder angepassten
Update-/Candidate-Hooks bleibt das normale NeDB-Update zuständig. Änderungen
dieser Voraussetzungen während der Wartezeit werden beim Start des Auftrags
nochmals geprüft. `BTS_SCORE_DIRECT_WRITES=0` schaltet den neuen Weg ab;
der Standard ist aktiv. Das Performance-Profil nennt `score_direct_writes`,
die Traces nennen den Executor-Auftrag `score_update_write` und ordnen ihn in
den Summen weiterhin als Datenbank-Update ein.

## Isolierte Prüfung

Reproduktion mit ausschließlich synthetischen Daten und temporären Dateien:

```sh
node debug/score_write_benchmark.js > /tmp/bts-score-write-result.json
```

Sechs wechselnde Paare je Lastfall, 128 Spiele mit je 180 Verlaufseinträgen,
13 wechselnde Zielspiele. Jede Variante bekommt dieselben Eingaben in einer
eigenen Datei. Je Probe werden zwölf Aufwärmpunkte und 64 Messpunkte geschrieben,
insgesamt 384 Messpunkte pro Variante und Lastfall.

| Punkt speichern | Bisheriger Median / p95 | Neuer Median / p95 |
| --- | ---: | ---: |
| Ohne zusätzliche Last | 0,67 / 1,48 ms | 0,66 / 1,28 ms |
| Synthetischer 2-ms-Callback in jedem Loop-Durchlauf | 17,29 / 19,77 ms | 9,01 / 9,91 ms |

Der zweite Fall erzeugt Konkurrenz absichtlich. Er belegt den Nutzen der
eingesparten Durchläufe, keine Halbierung der Live-Latenz. Ohne diese Last zeigt
sich kaum ein Unterschied. Es werden weder Netzwerkempfang noch Sprachsynthese
oder Browserdarstellung gemessen. Alle Callback-Dokumente, vollständigen
Endzustände einschließlich Reihenfolge und erneut geladenen Dateien stimmen
mit den erwarteten Updates überein.

Zusätzlich ergaben sechs Vergleichspaare mit der vorhandenen Turnierkopie und
dem tatsächlichen BUP-v2-Handler identische vollständige persistierte Endstände:
Punkt und sechs gleichzeitige UI-Abfragen, Punkt während Sync sowie ein zweiter
Spielabschluss auf einem anderen Feld während der Nachbereitung des ersten. Dieser kleine
Vergleich ist eine Funktionsprüfung, keine belastbare Latenzprognose.

119 Regressionstests bestanden, darunter vorangehende/spätere Writes, wartende
Reads, gehaltene und fehlgeschlagene Appends, erneutes Dateiladen, Validierungs-
und Indexfehler, fremde/fehlende Spiele, TTL während der Wartezeit, angepasste
Hooks, Zeitstempel, Punktverteilung und gleichzeitiger BTP-Abgleich. ESLint der
betroffenen kleinen Module, des Benchmarks und der neuen Tests, Syntaxprüfung
des BUP-v2-Moduls sowie `git diff --check` bestanden.

Die [Messdaten](performance_test13_2026-10-23.json) enthalten die anonymisierten
Kennzahlen und Einzelproben. Das laufende Turnier und BTP wurden nicht verändert.
Nach BTS-Neustart soll ein vollständiger Live-Test den neuen Profilschalter und
die Wirkung auf p99, Maxima und das Leerlaufen der Queues prüfen. Die Verursachung
aller verbleibenden Spitzen ist weiterhin offen.
