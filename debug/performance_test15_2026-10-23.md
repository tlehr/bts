# Test 15: Verbesserung der Punkteübertragung und verbleibende Spitzen

Der direkte Speicherweg für Punkte ist aktiv. Die beobachteten Latenzen liegen
deutlich unter Test 13; das p99-Ziel unter 30 ms ist weiterhin knapp verfehlt.
Die größte Spitze entsteht beim BTP-Commit durch wiederholte Verarbeitung einer
großen Admin-Nachricht. Diese Arbeit wird jetzt zwischen Empfängern geteilt.
Ein weiterer Ausreißer enthält einen erheblichen Vorlauf im Testclient.

## Gelieferter Lauf

`bts-test-15.json`: Beginn 23.10.2026, 18:40:36 UTC; Laufzeit 686.560 ms,
`stop_reason: interrupted`, kein gemeldeter Testfehler. Anfangs 128 Spiele,
davon 52 beendet und 13 aktiv. `score_direct_writes: true` und entsprechende
`matches:score_update_write`-Traces bestätigen den neuen Punktespeicherweg.
Die Sprachverwaltung läuft weiterhin im eigenen Prozess.

| Empfang | Mittel | p50 | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 8,2 ms | 4 ms | 24 ms | 35 ms | 103 ms | 3 | 1.421/1.421 |
| Admin | 11,8 ms | 8 ms | 29 ms | 40 ms | 106 ms | 4 | 1.421/1.421 |

Test 13 erreichte 116/122 ms p99 für TV/Admin. Dies ist ein beobachteter
Unterschied zwischen Läufen mit anderen Anfangsdaten und anderer Laufzeit;
er beweist nicht, dass die gesamte Verbesserung allein vom Speicherweg stammt.
Schon die ersten zwei Minuten von Test 15 liegen bei 35/41 ms p99.

Der erste Zehn-Minuten-Zyklus wurde einschließlich Pause und erneuter Last
vollständig durchlaufen. In der Pause liefen die Warteschlangen nach 700 ms
leer. Es gibt keine gemeldeten Rückstau-Vorfälle und keine Lücken oder verworfenen
Einträge im Tracearchiv. Der Gesamttest wurde im zweiten Zyklus unterbrochen;
ein abschließender vollständiger Testabschluss ist damit weiterhin offen.

Die gemessenen synchronen Sprachschritte erreichen maximal 0,9 ms beim Sammeln
und 10,6 ms beim Senden; p99 liegt bei 0,3 bzw. 0,5 ms. Die großen Spitzen
lassen sich damit weiterhin nicht pauschal der Sprachverwaltung zuordnen.

## Größte Spitze: BTP-Commit und Admin-Fenster

Aktualisierung 224 benötigt 103/106 ms bis TV/Admin. Davon entfallen 96,1 ms
auf Warten hinter `fetch_sync_apply`. Die anschließende Kontextphase dauert
2 ms, die Speicherung 2,6 ms. Der wartende Punkt kommt damit selbst schnell
voran, sobald der Sync seine Sperren freigibt.

Der zugehörige Commit hält seine Sperren 132,5 ms. Die elf Writes benötigen
54 ms. Danach bleiben noch rund 75 ms bis zum Ende des gesperrten Auftrags.
In diesem Abschnitt zeigen die Traces wiederholt `admin_update_encode` mit
2–7 ms und Sendeschritte von 1–3 ms. `notify_change` codierte dieselbe große
Änderung bisher für jedes angeschlossene Adminfenster erneut. `ws` musste
anschließend außerdem jede JSON-Zeichenkette erneut in UTF-8-Bytes umwandeln.

Jetzt erzeugt jede Änderung einmal ihre JSON- und UTF-8-Darstellung. Die
Outboxes der Empfänger teilen den fertigen Buffer und senden weiterhin
Textframes. Jedes Fenster behält seine eigene Reservierung und Reihenfolge:
Eine bereits angeforderte Übersicht kommt weiterhin vor späteren Änderungen.
Die Bytes werden beim Broadcast erzeugt; spätere DTO-Änderungen beeinflussen
wartende Nachrichten nicht. Zwischen verschiedenen Änderungen gibt es keinen
Cache. Bestehende alternative `sendmsg`-Empfänger bleiben unterstützt.

Der Standard `admin_broadcast_shared: true` erscheint im Performance-Profil.
`BTS_ADMIN_BROADCAST_SHARED=0` aktiviert den bisherigen Weg. Die einmalige
Codierung wird als `admin_broadcast_encode` aufgezeichnet. Sperrumfang,
Schreibreihenfolge, Spielfelder und Spielreihenfolge werden nicht verändert.

## Zweiter Ausreißer: Messbeginn vor dem Versand

Aktualisierung 1259 enthält folgenden zeitlichen Ablauf:

| Schritt | Zeit relativ zum gemeldeten `sent_ts` |
| --- | ---: |
| Messbeginn im Testclient | 0 ms |
| Unmittelbar nach Versandauftrag erzeugte Punktmeldung im Testclient | 82 ms |
| Beginn des BTS-Handlers | 83 ms |
| Empfang am TV | 98 ms |
| Empfang im Adminfenster | 102 ms |

Der Testclient setzt `sent_ts` in `Dashboard.record_score_sent`. Danach schreibt
er den Archiveintrag synchron mit `fs.writeSync`, bevor `BupV2Client.score` den
Punkt an den Socket-Transport übergibt. Der Worker-Zeitpunkt des tatsächlichen
Versands wird nicht aufgezeichnet. Der Bericht umfasst hier somit auch
Client-Vorlauf; er belegt keine 83-ms-Blockade innerhalb des BTS-Handlers.
Welche einzelne Clientoperation die 82 ms beansprucht, wurde nicht separat
gemessen. Die ursprünglichen Tablet→TV/Admin-Messwerte bleiben unverändert.

Gleichzeitig läuft eine Kompaktierung von `locations` mit nur einem Dokument.
Die Snapshot-Codierung dauert rund 0,5 ms. Die anschließende asynchrone
Dateivorbereitung liegt außerhalb der Executor-Sperre; der Dateitausch beginnt
erst nach Empfang dieses Punktes. Die Event-Loop-Messung im zugehörigen
Zeitfenster erreicht rund 27 ms. Die Überlappung begründet deshalb keine
Zuordnung des gesamten Ausreißers zur Kompaktierung. Gemeinsame Datenträgerlast
zwischen den Prozessen bleibt möglich. Der Testclient wurde nicht verändert.

## Prüfung der Änderung

```sh
node debug/admin_broadcast_benchmark.js > /tmp/bts-admin-broadcast-result.json
```

24 wechselnde Vergleichspaare nach dem Aufwärmen, elf Empfänger, synthetischer
Event-Datensatz mit 446.320 UTF-8-Bytes. Gemessen werden der echte Admin-/Outbox-
Weg und die Textframe-Erzeugung der installierten `ws`-Bibliothek.

| Gemeinsame Änderung an elf Empfänger | Median | p95 |
| --- | ---: | ---: |
| Bisher pro Empfänger codiert | 39,90 ms | 46,93 ms |
| Einmal codiert und als Buffer geteilt | 3,98 ms | 6,89 ms |

Jeder erzeugte Frame wurde auf vollständigen identischen JSON-Inhalt und
Texttyp geprüft. Der Vergleich misst keine echten Socket-Schreibvorgänge,
Netzwerkzustellung, Browserdarstellung oder vollständigen Sync-Commit. Die
Ergebnisse sind keine Vorhersage einer zehnfach besseren Live-Punktelatenz.

Sechs zusätzliche Vergleichspaare verwenden die bestehende temporäre
Turnierkopie mit tatsächlichem BUP-v2-Handler, UI-Abfragen und Integrationsplaner.
Alle vollständigen Endzustände einschließlich erneut geladener Dateien sind
identisch. Bei einer zusätzlich erzeugten großen Event-Benachrichtigung im
Sync-Commit erreichte der gleichzeitig eingereichte Punkt das TV-Mock zuvor nach
85,9/77,8 ms und danach nach 32,6/33,3 ms. Es wurden nur zwei Proben je Szenario
gemessen, einschließlich Kaltstarteffekten. Das ist eine ergänzende
Funktionsprüfung mit gerahmten Mock-Sockets und keine Live-Latenzgarantie.

206 Regressionstests bestanden, einschließlich echter lokaler WebSocket-
Übertragung an mehrere Empfänger, UTF-8 und JSON-Sonderfällen, reservierten
Antworten, getrennten Fensterständen, Verbindungsende, älteren Empfängern,
Fehlerweitergabe, Punkteverteilung und gleichzeitigen BTP-Abgleichen. ESLint
der betroffenen kleinen Module und neuen Tests, Syntaxprüfung von `admin.js`
und `git diff --check` bestanden.

Die [anonymisierten Messdaten](performance_test15_2026-10-23.json) enthalten die
Live-Kennzahlen und isolierten Proben. Nach BTS-Neustart kann der nächste Lauf
`admin_broadcast_shared: true` und die Wirkung im Livebetrieb bestätigen.
Das laufende Turnier und BTP wurden durch die Diagnose nicht verändert.
