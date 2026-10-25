# Performance: bts-test-9, 23.10.2026

Der Bericht bestätigt verbleibende Latenzspitzen. Hintergrundabfragen konkurrieren
mit Punkten und verlängern kritische BTP-Übernahmen und Spielabschlüsse. Die
Korrektur priorisiert diese kurzen Arbeitsschritte bis zur Freigabe ihrer Daten.

## Befund im gelieferten Bericht

Beginn: 17:28:10 UTC; Laufzeit 315.936 ms; `stop_reason: interrupted`.
128 Spiele, davon anfangs 33 beendet und 13 aktiv. 28 Spieleranmeldungen und
786 übertragene Spielstandsaktualisierungen einschließlich Abschlüssen.

| Empfang | Mittel | p95 | p99 | Maximum | Über 50 ms | Zugeordnet |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TV | 9,5 ms | 28 ms | 46 ms | 140 ms | 4 | 786/786 |
| Admin | 13,2 ms | 32 ms | 50 ms | 146 ms | 7 | 786/786 |

Das Ziel p99 < 30 ms wird verfehlt. Der unterbrochene Lauf liefert keinen
vollständigen Abschlussnachweis für die Warteschlangen.

Zwei besonders langsame Aktualisierungen:

- Aktualisierung 571: 140 ms bis TV, 146 ms bis Admin. Davon 121,2 ms Warten
  auf `fetch_sync_apply`. Dessen Ressourcensperren waren 178,1 ms gehalten;
  die Schreibphase beanspruchte 74 ms. Netzwerktransport und Worker-Planung
  lagen vor dem gesperrten Abschnitt.
- Aktualisierung 113: 98/100 ms bis TV/Admin, davon 84,9 ms Warten auf einen
  vorherigen Spielabschluss. Dessen Ergebnis war bereits veröffentlicht,
  während die Nachbereitung weiterhin gemeinsame Ressourcen sperrte.

Weitere Spitzen enthalten etwa 40 ms Wartezeit bei den Kontextabfragen.
Mehrere parallele Admin-Abfragen stellen jeweils sechs Leseaufträge ein.
Im Lauf gab es 2.526 Vorbereitungsabfragen. Diese Aufträge können die
asynchronen Datenbankabläufe auch dann verzögern, wenn die spätere Berechnung
und JSON-Ausgabe bereits kooperativ arbeiten.

## Änderung

- `preparation_selection/admin_reads`: Hintergrundabfragen warten vor ihren
  sechs Datenbanklesevorgängen sowie vor der Berechnung auf freie Priorität.
  Die geordneten Leseschranken und die Prüfung der Datenrevisionen bleiben wirksam.
- `foreground_work`: Die gesperrten Abschnitte `fetch_sync_apply` und
  `post_sync_auto_call_apply` erhalten ebenfalls Priorität. Abruf und Planung
  bleiben Hintergrundarbeit. Eigene interne Arbeit wartet nicht auf sich selbst.
- `bupws_v2`: Bei einem Spielabschluss endet die Priorität mit der geschützten
  Nachbereitung. Der gespeicherte Spielstand wird weiterhin sofort veröffentlicht.
- Beim Ende eines priorisierten Auftrags erhält der nächste wartende Auftrag
  einen Eventloop-Durchlauf, bevor die wartenden Admin-Abfragen fortsetzen.
  Anschließend wird erneut geprüft, ob Priorität benötigt wird.

## Isolierter Vergleich

Vorher/Nachher: unveränderter Stand vor dieser Korrektur gegen die drei geänderten
Module. Vier Gruppen in wechselnder Reihenfolge, pro Gruppe vier Durchläufe je
Szenario. Der erste Durchlauf jedes Szenarios pro Prozess dient zum Aufwärmen.
Damit verbleiben zwölf Messungen je Variante und Szenario.

Jeder Durchlauf öffnet eine eigene Dateikopie des Turniers. Gemessen werden die
echten BUP-v2-Punkthandler bis zur Übergabe an einen initialisierten simulierten
TV und den Admin, gleichzeitig mit sechs Vorbereitungsabfragen samt vollständiger
JSON-Kodierung. Eingehende Aufträge verwenden einen unabhängigen `AsyncResource`,
damit sie wie Netzwerkereignisse außerhalb des Prioritätskontexts eintreffen.
Das Sync-Szenario verändert zehn Spiele einschließlich des Punktziels; das
Abschluss-Szenario sendet einen zweiten Abschluss während der ersten Nachbereitung.

| Mittlere Dauer | Vorher | Nachher |
| --- | ---: | ---: |
| Normaler Punkt bis TV unter Admin-Last | 15,2 ms | 9,1 ms |
| Punkt während BTP-Übernahme bis TV | 39,6 ms | 9,7 ms |
| Gesperrter BTP-Übernahmeabschnitt | 37,5 ms | 6,3 ms |
| Zweiter Abschluss bis TV | 27,6 ms | 21,0 ms |
| Nachbereitung des ersten Abschlusses | 21,8 ms | 15,8 ms |

Die Diagnoseantworten selbst warten länger: im Sync-Szenario im Mittel
38,2 statt 32,3 ms, im Abschluss-Szenario 78,8 statt 65,6 ms. Die Änderung
verschiebt Arbeit zugunsten der Spielstandübertragung; sie ist kein Nachweis
eines insgesamt höheren Durchsatzes.

Alle 48 Vorher/Nachher-Paare haben identische Endstände. Alle 96 Datenkopien
stimmen mit ihrem erneut von Platte geladenen Zustand überein. Zufällig erzeugte
Dokument-IDs neuer Tabletbediener werden beim Vergleich zwischen Varianten
ausgenommen. Die Inhalte aller 13 Quelldateien sind per SHA-256 unverändert.

Es gibt dabei keine Verbindung zum laufenden BTS, zu BTP oder zum Sprachserver.
Nachgelagerte automatische Vorbereitung ist außerhalb des gemessenen Abschnitts
deaktiviert. Die Messung enthält keine Netzwerk- oder Browserlaufzeit. Der höchste
TV-Wert nach dem Aufwärmen beträgt noch 50,1 ms beim zweiten Abschluss; ein
erreichtes Live-p99-Ziel wird daraus ausdrücklich nicht abgeleitet.

Temporäre Messdaten und Reproduktion:
`/tmp/bts-test9-priority-results.json`, `/tmp/bts-test-9-analysis.json`,
`/tmp/bts-test-9-slow-points.json`, `/tmp/bts-test9-priority-benchmark.js` und
`/tmp/bts-test9-priority-data/`.

## Prüfung

191 Tests aus 16 betroffenen Testsuiten bestanden: Punktübertragung,
Spielabschluss und Fehlerbehandlung, Datenleseschranken, Prioritätsübergabe,
BTP-Übernahme, automatische Aufrufe sowie deren Nebenläufigkeit.
ESLint für die kleinen geänderten Module und betroffenen Tests, Syntaxprüfung
von `bupws_v2.js` und `git diff --check` bestanden.

Ein bereits vor dieser Korrektur fehlschlagender Reihenfolge-Test wurde auf
eine reine Änderung der BTP-Positionen umgestellt. Seine vorherige Umnummerierung
änderte zusätzlich das Sprachinventar der ersten Runde in `events` und prüfte
dadurch keinen reinen Reihenfolge-Abgleich mehr. Die Assertions zur parallelen
Ausführung und zum Erhalt des aufgerufenen Spiels bleiben erhalten.

Für den endgültigen Nachweis ist BTS mit dem geänderten Code zu starten und
der vollständige Live-Test erneut auszuführen. Dabei sind insbesondere beide
p99-Werte, Spielabschlüsse während eines Abgleichs und der Warteschlangenabschluss
zu prüfen.
