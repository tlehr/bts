# Test 11: Sprachintegration und verbleibende Kopplung

Der Bericht belegt keine Verursachung der Verzögerungen durch die Sprachausgabe.
Die längsten Punktübertragungen enthalten vor allem Wartezeiten beim Lesen und
Speichern von Spielständen. Die bisherige Sprachverwaltung hatte aber noch
eine gemeinsame Ressource mit BTS: Worker-Threads teilen dessen libuv-Pool.
Diese Kopplung wird durch einen eigenen Sprachprozess beseitigt.

## Gelieferter Lauf

`bts-test-11.json`: Beginn 23.10.2026, 17:57:49 UTC; Laufzeit 136.591 ms,
`stop_reason: interrupted`. Anfangs 128 Spiele, davon 41 beendet und 13 aktiv.

| Empfang | Mittel | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 10,3 ms | 28 ms | 94 ms | 124 ms | 6 | 337/337 |
| Admin | 14,3 ms | 34 ms | 99 ms | 132 ms | 6 | 337/337 |

Beispiele aus den korrelierten Punkttraces:

- Aktualisierung 248: 123/132 ms bis TV/Admin; 18,6 ms Warten auf den
  Scheduler, 23,1 ms Kontextabfragen und 64,1 ms Datenbank-Updatephase.
- Aktualisierung 249: 124/127 ms bis TV/Admin; 5,4 ms Kontextabfragen und
  98,5 ms Datenbank-Updatephase, einschließlich Warten auf den vorherigen Writer.
- Aktualisierung 167: 94/99 ms bis TV/Admin; jeweils 38,2 ms für Kontextabfragen
  und die Updatephase, gleichzeitig mit Admin-Abfragen und Spieleranmeldungen.

Eine Updatephase misst auch Executor-Warten und Callback-Zustellung; sie
identifiziert keine reine physische Plattenlaufzeit. Die beiden größten
Punktspitzen überlappen einen GC von 10,3 ms. Dieser erklärt ihre Gesamtdauer
ebenfalls nicht allein.

Der Bericht enthält keine eigenen Sprach-Snapshot-/IPC-Zeiten und keinen
eindeutigen Sprach-Ausführungsmodus. Ein kontrollierter Live-Vergleich bei
identischem Turnierstand mit und ohne Sprache fehlt. Der kürzere Lauf und der
geänderte Anfangszustand erlauben auch keinen direkten Regressionsnachweis
gegenüber Test 9.

## Umsetzung

- Standardmäßig verwaltet ein langlebiger Node-Kindprozess die Sprachplanung,
  Cache-Dateien, Sprachserver-Aufträge und direkte Audioauslieferung.
  Der [libuv-Pool ist prozessweit gemeinsam](https://docs.libuv.org/en/v1.x/threadpool.html);
  ein zusätzlicher Worker-Thread trennt diese Dateiarbeitswarteschlange nicht.
  Der Kindprozess hat seinen eigenen Pool. Host-CPU und Datenträger bleiben geteilt.
- Signierschlüssel und Konfiguration werden per privatem IPC übertragen.
  Neustart, ausstehende Anfragen, Cache und signierte Audioabrufe behalten ihr
  Verhalten. Fatalfehler werden mit Ursache an BTS gemeldet. Ein geschlossener
  Elternprozess beendet den Sprachprozess und seinen Audioanschluss.
- Große Sprach-Statusantworten verwenden den vorhandenen kooperativen
  Admin-Encoder mit Punktpriorität.
- Neue Performance-Daten nennen Prozess-/Threadmodus, Kennung, ausstehende
  Anfragen und Anzahl/Dauer der Sendeschritte. Die aktivierten Traces enthalten
  `speech_request`, `speech_snapshot`, `speech_snapshot_collect` und
  `speech_bridge_send`. Sammel- und Sendespans zeigen die synchronen Restkosten;
  die Gesamt-Snapshotdauer enthält auch beabsichtigtes Warten auf Punkte.
  Ansagetexte und Zugangsdaten werden nicht erfasst.

Für Vergleiche wählt `BTS_SPEECH_WORKER_TYPE=thread` bzw.
`speech.worker_type: "thread"` die bisherige Thread-Ausführung. Standard ist
`"process"`; die vorhandene Einstellung `speech.worker: false` bleibt wirksam.

## Isolierte Messungen

Die [Messdaten](performance_speech_process_2026-10-23.json) enthalten sechs
wechselnde Paare nach dem Aufwärmen. Der I/O-Vergleich verwendet ausschließlich
temporäre Dateien und synthetische Daten, einen absichtlich auf einen Thread
begrenzten libuv-Pool und echte persistierte NeDB-Appends.

| Median eines NeDB-Appends | Worker-Thread | Eigener Prozess |
| --- | ---: | ---: |
| Gleichzeitig synthetische Cache-Persistenz | 0,35 ms | 0,39 ms |
| Kontrolliert belegter libuv-Pool | 265,1 ms | 1,34 ms |

Der erste Fall zeigt keinen relevanten Nachteil durch die einfachen
Cache-Schreibvorgänge. Im zweiten Fall belegt ein PBKDF2-Testauftrag den Pool,
bevor der Append ankommt. Das ist ausdrücklich keine Sprachsynthese. Dieser
Stresstest beweist die Trennung der Ressourcen, keine Sprachverursachung der
Live-Ausreißer. Jeder Append wurde nach erneutem Laden seiner Datei geprüft.

Der vorhandene Sprachplanungs-Benchmark verwendet 519 synthetische Spiele mit
je 180 Verlaufseinträgen, ohne Sprachsynthese, Browser oder echte Turnierdaten.
Die alten Hauptprozessmodule wurden für die Vergleichsmessung separat geladen.
Beide Varianten prüfen ihre vollständigen Planungsergebnisse gegen dieselbe
Inline-Berechnung.

| Messgröße | Bisheriger Thread | Eigener Prozess |
| --- | ---: | ---: |
| Median der maximalen Verspätung eines 2-ms-Timers | 1,26 ms | 1,48 ms |
| Größte Timer-Verspätung nach dem Aufwärmen | 3,22 ms | 2,91 ms |
| Median der gesamten Planung einschließlich Vorlauf | 1.274 ms | 1.231 ms |
| Erststart einschließlich erster Planung | 1.409 ms | 1.553 ms |

Beide isolieren die JavaScript-Planung ähnlich gut. Aus den kleinen Unterschieden
folgt kein Live-p99-Versprechen. Unveränderte Folgesnapshots übertragen weiterhin
null Datensätze. Reproduktion des I/O-Vergleichs:

```sh
node debug/speech_io_isolation_benchmark.js
```

## Prüfung und nächster Live-Lauf

341 Tests bestanden. Darunter sind Audioabruf und HTTPS, Wiederanlauf mit
Diskcache, Prozessabbruch, Schließen des Audioports nach Elternprozessende,
belegter Audioport, WebSocket-Steuerung, Hintergrundantworten, Diagnose ohne
Texte/Schlüssel sowie Punktübertragung und Leseschranken. Zusätzlich bestanden
die 24 nativen Chrome-/FastAPI-Integrationsfälle: 23 im gemeinsamen Lauf und
der Cache-Wiedergabefall nach einer Testkorrektur einzeln. Dieser Fall scheiterte
auch mit dem gesicherten vorherigen Code an fehlender Browser-Audiofreigabe.
Er setzt jetzt einen eigenen echten Benutzerklick voraus, statt die Freigabe
von früheren Tests zu übernehmen. Diese ältere native Suite verwendet ihren
Inline-Testadapter; der Prozessbetrieb wird durch die separaten HTTP-/HTTPS-,
WebSocket-, Neustart- und Elternprozess-Tests geprüft.
ESLint der betroffenen kleinen Module und Tests, Syntaxprüfung des Brokers und
`git diff --check` bestanden.

BTS muss für die neue Ausführung neu gestartet werden. Ein weiterer vollständiger
Live-Test soll `speech.execution: "process"` bestätigen und die neuen
Sprachtraces mit langsamen Punkten vergleichen. Eine pauschale Zuordnung der
verbleibenden Ausreißer zur Sprachausgabe ist bisher nicht begründet.
