# Test 17: Größeres Turnier und falsche Prioritätszuordnung

Test 17 ist ein neuer Lauf mit aktiver gemeinsamer Admin-Codierung und direkter
Punktespeicherung. Die Latenzziele werden verfehlt. Das Turnier enthält diesmal
373 statt 128 Spiele. Ein reproduzierter Fehler bei der Zuordnung der
Hauptthread-Priorität ist korrigiert; ein verlässlicher Gewinn bei der gesamten
Punktelatenz ist im isolierten Vergleich noch nicht belegt.

## Gelieferter Lauf

`bts-test-17.json`: Beginn 23.10.2026, 19:10:22 UTC; Laufzeit 395.010 ms,
`stop_reason: interrupted`, kein gemeldeter Testfehler. Anfangs 373 Spiele,
davon 65 beendet und 13 aktiv. `admin_broadcast_shared: true` und
`score_direct_writes: true` sind im Serverprofil vorhanden. Der Sprachprozess
läuft; am Ende sind keine Sprachanfragen ausstehend.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 17,9 ms | 11 ms | 59 ms | 93 ms | 183 ms | 63 | 877/877 |
| Admin | 22,5 ms | 16 ms | 64 ms | 108 ms | 195 ms | 86 | 877/877 |

Alle gesendeten Aktualisierungen wurden zugeordnet. Es gibt keine gemeldeten
Rückstau-Vorfälle und keine Lücken oder verworfenen Einträge im Tracearchiv.
Zu Beginn der Pause liefen die Queues nach 3.249 ms leer. Der Lauf wurde etwa
35 Sekunden nach Beginn dieser Pause unterbrochen; ein vollständiger Zyklus
einschließlich erneuter Last liegt hier nicht vor.

Die p99-Werte sind höher als die 35/40 ms aus Test 15. Andere Anfangsdaten,
die größere Spielanzahl und die andere Laufzeit erlauben keine kontrollierte
Zuordnung dieses Unterschieds zur zuletzt eingeführten Admin-Optimierung.

## Verbleibende Spitzen

| Aktualisierung | TV / Admin | Vor Handlerbeginn | Lock-Warten | Kontext lesen | Updatephase |
| --- | ---: | ---: | ---: | ---: | ---: |
| 132 | 183 / 195 ms | 26 ms | 89,9 ms | 1,2 ms | 59,5 ms |
| 133 | 170 / 178 ms | 53 ms | 2 ms | 69,8 ms | 43 ms |
| 131 | 173 / 175 ms | 7 ms | 141 ms | 3,5 ms | 9,1 ms |
| 291 | 120 / 127 ms | 15 ms | 12 ms | 84 ms | 7,4 ms |

131 und 132 warten hinter demselben BTP-Commit. Dieser hält seine Sperren
215,5 ms, davon 160 ms in der Schreibphase. Bei 133 setzt sich die Verzögerung
in der gemeinsamen Match-Datenbank fort: Der Punkt wartet beim Lesen auf den
vorherigen Writer. Bei 132/133 enthalten die anschließenden Updates außerdem
34,1 bzw. 28,8 ms instrumentiertes Append-/Callback-Warten. Das ist weder eine
reine physische Plattenzeit noch exklusive CPU-Arbeit.

Andere Spitzen überlappen Vorbereitungsabfragen und Nachbereitungen. Die
Gesamtdauer einer Abfrage enthält dabei auch beabsichtigtes Warten auf Punkte.
Ein 3.086-ms-Trace für `post_sync_auto_call_apply` umfasst mehrere Planungs- und
Validierungsversuche; er bedeutet keine 3-Sekunden-Sperre. Die einzelnen
Lock-Haltezeiten dieses Traces liegen zwischen rund 10 und 132 ms.

Die höchste Event-Loop-Timermessung beträgt rund 83,9 ms bei 20-ms-Auflösung.
In einer Spitze erreicht die gemessene Event-Loop-Auslastung rund 90 Prozent.
Überlappende GCs erklären die langen Warteketten nicht allein. Bei den oben
untersuchten Ausreißern liegen zwischen dem Messbeginn und der anschließenden
Punktmeldung im Testclient nur 0–1 ms; der große Client-Vorlauf aus Test 15
erklärt diese Spitzen somit nicht.

Die synchronen Sprach-Sammelschritte erreichen maximal 1,6 ms, die Sendeschritte
maximal 15 ms. Gemeinsame Admin-Codierungen erreichen maximal 11,4 ms. Das belegt
keine alleinige Verursachung der langen Warteketten durch die Sprachausgabe.

## Reproduzierter Prioritätsfehler und Korrektur

NeDB führt seine Aufträge seriell aus. Der Callback eines Auftrags plant den
nächsten Queue-Durchlauf in seinem eigenen asynchronen Kontext. Dieser Kontext
gehörte dadurch gegebenenfalls zum vorherigen Punkt oder Sync, obwohl der
nächste Auftrag von einem anderen Aufrufer stammte.

Die Datenbankbeobachtung stellte bisher den Trace-Kontext wieder her, aber
nicht den Kontext für die Hauptthread-Priorität. Ein `foreground.release()` im
Punkte-Callback konnte deshalb die Priorität eines anderen, noch laufenden
Auftrags freigeben. Hintergrundarbeit konnte umgekehrt einen fremden aktiven
Prioritätskontext erben und ihre Warteprüfung überspringen. Dies ist mit echten
NeDB-Executoren reproduziert, unabhängig von aktivierten Timing-Logs.

Jetzt erfasst `database_tasks.js` den Besitzer beim Einreihen und stellt ihn
beim Ausführen und bei der Callback-Zustellung ausdrücklich wieder her.
`foreground_work.run` setzt auch einen leeren Kontext, damit Hintergrundaufträge
keinen fremden Besitzer vom Scheduler erben. Freigaben betreffen damit wieder
den vorgesehenen Auftrag. Eigenes Warten auf Priorität bleibt ausgeschlossen,
und freigegebene Kontexte gelten weiterhin nicht als aktive Besitzer.

Die Änderung verändert keine Datastore-Reihenfolge, Ressourcenlocks,
Persistenzschritte, Spielnummern oder Spielfelder. Sie garantiert für sich
genommen noch keine bestimmte Live-Latenz.

## Isolierte Prüfung und CPU-Profil

Sechs neue Tests prüfen fremde Executor-Aufrufer, Hintergrund-Callbacks,
externe Callback-Zustellung, ResourceQueue-Dispatch und das Vermeiden einer
Selbstblockade. Mit den gesicherten bisherigen Modulen scheitern fünf dieser
Tests; mit der Korrektur bestehen alle sechs. Der Baseline-Test wurde über
Mochas eigenes `--require` ausgeführt, damit der Preload auch im Testprozess
wirkt.

Mit einer Kopie des aktuellen Turniers wurden drei vollständige, wechselnd
angeordnete Vorher-/Nachher-Vergleiche ausgeführt: 36 Vergleichspaare mit 373
Spielen und 13 aktiven Spielen. Alle vollständigen Endzustände stimmen überein,
auch nach erneutem Laden der gespeicherten Dateien.

| Szenario, je 12 Proben | Bisheriger Median bis TV-Mock | Neuer Median bis TV-Mock |
| --- | ---: | ---: |
| Punkt und sechs UI-Abfragen | 7,85 ms | 8,87 ms |
| Punkt hinter einem Sync desselben Spiels | 9,80 ms | 13,26 ms |
| Zweiter Abschluss während der Nachbereitung des ersten | 24,80 ms | 15,49 ms |

Die Maxima schwanken stark, einschließlich eines höheren Maximums im letzten
Szenario nach der Korrektur. Ein allgemeiner Latenzgewinn ist damit nicht
nachgewiesen. Diese Szenarien prüfen die Funktionsgleichheit bei konkurrierender
Arbeit, bilden aber nicht jede Kollision zwischen einem unabhängigen Punkt und
einem noch aktiven Sync ab. Kaltstarts sind enthalten; Netzwerkempfang und
Browserdarstellung fehlen.

Ein separates Sampling-Profil des eigenen Testharness zeigt Arbeit in
`btp_planner/refresh_writes` und den Vorbereitungsdiagnosen. Der erste synchrone
Teil der Vorbereitung benötigt in den instrumentierten Proben häufig etwa
5–10 ms, beim ersten Aufruf auch über 20 ms. Das Profil enthält außerdem
Mock-JSON-Decodierung und Profiler-Aufwand und ist kein Profil des Live-Servers.
Inklusive Funktionssamples überlappen und dürfen nicht addiert werden. Eine
vierte Vergleichswiederholung wurde vollständig verworfen, weil ihre letzte
Probe mit dem Profiling überlappte. Profiling-Ergebnisse wurden nicht für einen
Vorher-/Nachher-Geschwindigkeitsnachweis verwendet.

Für weitere Live-Diagnosen erfasst `preparation_selection_sync_start` nun den
ersten synchronen Teil einer tatsächlichen Vorbereitungsberechnung samt Anzahl
der Eingabespiele. Die übrige Antwortzeit enthält weiterhin Queue-Warten,
Prioritäts-Warten und kooperative Diagnosearbeit. Dieser zusätzliche Span
zeichnet weder Spielerinformationen noch Anfragedaten auf.

251 Regressionstests bestanden, darunter Punkteverteilung, gleichzeitige
BTP-Abgleiche, Schreibreihenfolge, Modell-Leseschranken, Admin-Reservierungen,
Planungsrefresh, Sprachprozess und Geräteinformationen. Nach der zusätzlichen
Zeitmessung bestanden nochmals die 34 unmittelbar betroffenen Tests. ESLint
der geänderten Module und neuen Tests sowie `git diff --check` bestanden.

Die [anonymisierten Messdaten](performance_test17_2026-10-23.json) enthalten
Kennzahlen, Proben und die Grenzen der Vergleiche. Das laufende Turnier und BTP
wurden durch die Diagnose nicht verändert. Ein BTS-Neustart lädt die korrigierte
Prioritätszuordnung und die zusätzliche Messung. Die Live-Wirkung der Korrektur
und das Erreichen des p99-Ziels bleiben offen.
