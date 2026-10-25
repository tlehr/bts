# Wiederholbarer Live-Benchmark

Für die Geschwindigkeit der eigentlichen Ansagen gibt es zusätzlich eine
[offline Tempo-Prüfung](../docs/speech-tempo-preflight.md) mit Messwerten und
Hörvergleich. Der [Bericht zu Test 28](performance_test28_2026-10-24.md) trennt
diese Audioeigenschaft von den gemessenen TV-/Admin-Empfangslatenzen.
Der [Vergleich von Test 29 mit Test 28](performance_test29_2026-10-24.md)
untersucht die erneut höheren Latenzen anhand konkreter Warteketten.
Der [Bericht zu Test 30](performance_test30_2026-10-24.md) zeigt die wieder
gesunkenen Wartezeiten und untersucht den verbleibenden höchsten Ausreißer.
Der [isolierte Sprachlastvergleich](performance_speech_contention_2026-10-24.md)
misst vier Varianten mit echter nativer Synthese und dokumentiert die
CPU-Priorität als Schutzmaßnahme. [Aufruf und Grenzen](speech_load/README.md).

Der Live-Testclient und das Webdashboard liegen jetzt im eigenen Repository
`bts-testclient` neben diesem BTS-Checkout. Dort `git submodule update --init
--recursive` und `npm ci` ausfuehren; `npm start` oeffnet den lokalen Dashboard-
Server. Die bisherigen `npm run debug:*`-Starter hier leiten an diesen Client
weiter. Fuer andere Verzeichnisse `BTS_TESTCLIENT_DIR` setzen. Die Clientversion
ist in `testclient.version.json` dokumentiert. Interne Serverbenchmarks und die
unten archivierten Messungen bleiben in diesem Repository. Aktuelle Bedienung
und alle Clientoptionen stehen in dessen README; Serververgleich zusaetzlich in
`reference_comparison.md`. Das neue Standardprofil der Sequenz ist
`combined-responsive-cached-admin`; alte Profile schalten den neuen Cache explizit
aus, um dessen Wirkung getrennt vergleichen zu koennen.

Für die Bedienung im Browser gibt es jetzt ein lokales Testdashboard. BTS wie
gewohnt starten; anschließend im Repository:

```bash
npm run debug:dashboard
```

[http://127.0.0.1:4444](http://127.0.0.1:4444) öffnen. Die Oberfläche startet erst
beim Klick auf **Test starten** eine Simulation. Serveradresse und Turnier
eintragen; **Verbindung prüfen** lädt die verfügbaren Turniere als Vorschläge.
as Zur Auswahl stehen die bisherige feste zehnminütige Sequenz und der freie Test.
**Weitere Einstellungen** enthält sämtliche Simulationsparameter, einschließlich
Punktabständen, erwarteter Spielanzahl, Seed, Check-in-Abständen, Punktverteilung,
Tablet-Akku und simulierter TV-Verarbeitungszeit. Die feste Sequenz behält ihre
Phasen und die automatische Ruhephase; Pause und Tempo sind nur im freien Test
manuell steuerbar. Eine falsche erwartete Spielanzahl beendet den Start, bevor
Punkte oder Check-ins gesendet werden; 0 deaktiviert diese Prüfung.

Die Oberfläche zeigt Empfangslatenzen, Rückstau und Fortschritt zuerst. Weitere
Ansichten bieten eine vereinfachte Ablaufgrafik, interaktive SVG-Verläufe für
Queue-Anzahl, älteste Wartezeit und Event Loop, alle Spielfelder, kumulative
Nachrichtentypen sowie aufklappbare Diagnoseereignisse. Die Ablaufgrafik ist ein
Modell der Zusammenhänge mit aktuellen Messwerten, kein Trace eines einzelnen
Punkts. Browser-Rendering und Audioausgabe werden weiterhin nicht gemessen.
Die Verlaufsgrafiken behalten bis zu fünf Minuten; Gesamtwerte und Payload-Typen
gelten für den ganzen Lauf. Bei fehlender Telemetrie erscheinen Lücken statt
falscher Nullwerte. Details bleiben bei Updates geöffnet.

**Test beenden** stoppt den eigenen Simulationsprozess; danach lässt sich der
vollständige JSON-Bericht herunterladen. Die Weboberfläche und Darstellung
laufen außerhalb des Simulationsprozesses; der bestehende Testmotor simuliert
weiterhin die Tablets und TVs und misst den Empfang. Neu laden oder Schließen
eines Browserfensters stoppt einen laufenden Test nicht. Beim Wiederverbinden
erscheinen derselbe Test und der bisherige Verlauf; mehrere Browserfenster
beobachten und steuern denselben Lauf. Mit Strg+C im Dashboard-Terminal wird
auch ein noch laufender eigener Test beendet. Die Anwendung startet oder stoppt
keinen BTS-Server und setzt kein Turnier zurück. Punkte und Check-ins verändern
das ausgewählte Turnier wie beim bisherigen Testclient.

Der HTTP-Dienst bindet ausschließlich an `127.0.0.1`. Mit
`npm run debug:dashboard -- --port 4445` lässt sich ein anderer lokaler Port
wählen. Es werden keine zusätzlichen Pakete, CDN-Skripte oder Dienste benötigt.
Die bisherigen Konsolenbefehle und automatisierten Vergleichssequenzen bleiben
verfügbar. Das Webdashboard führt einen Live-Test zur Zeit aus; die automatische
Sequenz verschiedener Serverprofile läuft weiterhin über ihren bestehenden
Konsolenbefehl. Der Browser lädt Berichte herunter, statt einen beliebigen
Dateipfad im Testclient anzugeben.

`make dev` zeigt die Start- und Neustartmeldungen des Supervisors.
Er überwacht nur den Servercode in `bts/`; Änderungen an Tests oder
Hilfsskripten starten den Server nicht neu. „crashing child“ bezeichnet einen
vom Watcher angeforderten Neustart und belegt keinen Anwendungsabsturz.
Echte Ansagenfehler werden unabhängig von der Diagnoseeinstellung mit Ursache
ausgegeben und in allen Adminfenstern als auffällige Störung angezeigt.
Nur der Ansagen-Worker wird bei einem Ausfall neu gestartet. Identische Fehler
werden im Terminal höchstens alle 30 Sekunden wiederholt.
Die Serverdiagnose wird sowohl bei `make dev` als auch bei `make run` über die
gespeicherte Einstellung in der UI gesteuert. Ohne aktivierte Debugoptionen
gibt BTS keine normalen Betriebs- oder Diagnosemeldungen aus.
Echte Fehler und die Supervisor-Meldungen bleiben sichtbar.
Die Option **Ausführliche Serverdiagnose aktivieren** unter Turniereinstellungen
→ Debug schaltet Sync-Messungen, langsame Queue-Aufgaben, Render-Bestätigungen,
DB-Diagnosen und Tabletoperator-Audits ein. Ein- und Ausschalten wirkt sofort;
die Auswahl bleibt nach einem Neustart erhalten. Gemeinsame Queue-/DB-Diagnosen
werden ausgegeben, sobald die Option für ein Turnier aktiv ist.

Alternativ aktiviert `BTS_SERVER_DIAGNOSTICS=1` diese Stufe serverweit.
Explizite einzelne Diagnosevariablen übersteuern weiterhin ihre jeweilige
Kategorie; insbesondere aktivieren `BTS_TABLETOPERATOR_AUDIT=1` die Audits und
`BTS_BTP_SYNC_TIMING=1` die Sync-Messungen unabhängig vom Menü. Ohne gesetzte
Variablen steuert das Menü die Ausgaben bei `make dev` und `make run`.
`BTS_TABLETOPERATOR_AUDIT=0` ist für einen normalen Start nicht erforderlich.

Server wie bisher mit Timing-Ausgaben starten:

```bash
BTS_DEBUG_OUTPUT=1 BTS_SCORE_PRESS_TIMING=1 BTS_BTP_SYNC_TIMING=1 make dev 2>&1 | tee /tmp/bts-server-timing.log
```

Danach die zehnminütige Sequenz starten:

```bash
npm run debug:benchmark -- --base-url https://localhost:4433 --tournament default --dashboard 2>&1 | tee /tmp/bts-live-drill.log
```

| Zeit ab Start | Aktionen des Clients |
| --- | --- |
| 0–2 Minuten | Spielen und anfänglich fehlende Check-ins verteilt nachholen |
| 2–6 Minuten | Spielen auf allen belegten Feldern, laufend weitere Check-ins |
| 6–8 Minuten | Keine Punkte, Reparaturen oder Check-ins; TVs und Turnierabfragen bleiben aktiv |
| 8–10 Minuten | Spielen und laufende Check-ins fortsetzen |

Der Client endet automatisch. `q` oder Strg+C beendet ihn vorzeitig. Manuelle
Änderungen an Tempo und Pause sind in dieser Sequenz deaktiviert. Die normalen
interaktiven Funktionen von `npm run debug:live-drill` bleiben verfügbar.

Standardmäßig erwartet der Benchmark 519 Spiele, verwendet Seed `519` und
Punktintervalle von 3200–6400 ms. Die Bestätigung eines Spielendes erfolgt als
separate Aktion nach einem weiteren Punktintervall. Mit `--expected-matches N`
kann eine andere Spielanzahl geprüft werden; `0` deaktiviert diese Prüfung.

Die Sequenz setzt am aktuellen Turnierstand an und setzt keine Spiele zurück.
Sie checkt ausschließlich Spieler von Begegnungen im Zustand `preparation` ein,
die noch nicht auf dem Feld stehen. Geplante und blockierte Spiele werden nicht
eingecheckt. Bei jeder Turnierabfrage wird erneut geprüft, welche Spiele inzwischen
in Vorbereitung sind. Anfängliche Check-ins werden nach Begegnung über höchstens
110 Sekunden verteilt; die letzten zehn Sekunden sind für Antworten reserviert.
Die Spieler der ersten Vorbereitung werden sofort eingecheckt. Neue vorbereitete
Begegnungen sowie wieder fehlende Check-ins in Vorbereitungen werden während aller Spielphasen
weiter berücksichtigt. Spielende und Tablet-Bediener werden erst eingecheckt,
wenn sie wieder verfügbar sind. Bei Fehlern wird nach zehn Sekunden erneut
versucht; ein langsamer Server oder nicht verfügbare Spieler können das Ziel
von zwei Minuten verhindern. Das Ergebnis nach zwei Minuten steht im Bericht.
Der Server prüft den Vorbereitungszustand unmittelbar vor dem Check-in erneut,
damit ein zwischenzeitlicher Zustandswechsel keine weiteren Check-ins auslöst.

`/tmp/bts-live-drill-report.json` enthält pro Phase:

- Punkte, Spielendebestätigungen, Check-ins und Check-in-Fehler;
- Tablet-zu-TV- und Tablet-zu-Admin-Latenz mit Mittelwert, Median, p95, p99 und Maximum sowie Anzahl
  gesendeter und nicht zugeordneter Updates und Erfassungsquote (`coverage`);
- die etwa jede Sekunde erfasste Anzahl belegter und freier Felder;
- geplante und tatsächliche Phasengrenzen.

Die Latenzmessung berücksichtigt die aktuelle Links-/Rechts-Zuordnung der Teams
auf dem TV, auch nach einem Seitenwechsel. Berichte mit
`latency_matching: "display-side-score"` verwenden diese Zuordnung. Ältere
Berichte können nach Seitenwechseln Updates übersehen; ihre TV-Latenzen sind
daher nur eingeschränkt vergleichbar. Ein TV-Update ohne passenden Spielstand
bestätigt keinen gesendeten Punkt.

Das Dashboard zeigt beide Empfangslatenzen über die **gesamte Laufzeit**, mit
Anzahl gesendeter/zugeordneter Updates, Mittelwert, p95, p99 und Maximum. In den
Feldzeilen stehen zusätzlich letzter Wert und Minutenmittel für TV und Admin.
Die Payload-Tabelle zählt sämtliche empfangenen TV-Anzeigepayloads und
Admin-Nachrichten während des Laufs, getrennt nach Quelle und Typ; kein
Fünfminutenfenster und keine Begrenzung auf acht Typen mehr. Bei Admin-Changes
wird der Untertyp angezeigt, beispielsweise `change:score`. Timer-/Status- und
Antwort-Payloads werden gezählt, erzeugen aber keine Punktlatenzprobe.
Typen mit zugeordneten Punkten stehen in der Latenztabelle. Die übrigen Typen
erscheinen platzsparend darunter als `Typ=Anzahl`, ohne leere Statistikspalten.

Der Admin-Testclient empfängt dasselbe `change:score`-Event wie die Admin-Seite
über die vorhandene Admin-WebSocket-Verbindung. Die Zuordnung prüft Turnier,
Spiel, Feld, Team-Spielstand, letzten Tastendruck und Spielendestatus. TV und
Admin haben unabhängige Zuordnungen; doppelte oder veraltete Ereignisse zählen
nicht erneut. Der Empfangszeitpunkt wird für beide Clients am Anfang des
WebSocket-Message-Callbacks vor JSON-Decodierung erfasst. Browser-Rendering oder
Change-Queue-Verarbeitung werden damit nicht gemessen.
Der Bericht kennzeichnet diese Grenze mit `latency_endpoint`; ältere
TV-Messungen nahmen den Zeitpunkt erst nach dem JSON-Decodieren und Anwenden
des Payloads im Testclient. Diesen kleinen Messunterschied beim Vergleichen
alter und neuer Berichte berücksichtigen.

`Unmatched` umfasst noch ausstehende sowie nach 30 Sekunden nicht zugeordnete
Updates; es ist kein Nachweis verlorener Nachrichten. Die Gesamtwerte und
Payload-Typen stehen auch im JSON-Bericht (`tablet_to_tv_ms`,
`tablet_to_admin_ms`, `payload_types`) und in der abschließenden Logzeile.

Mit **1–4** kann man während des Tests die Ansicht wechseln, auch während eines
Benchmarks: **1 Übersicht** (Felder, Empfangslatenzen und Rückstauhinweise),
**2 Queues** (Locks, Datenbank-Collections, Worker und Admin-Versand),
**3 Payloads** (kumulative Typzähler und Latenzen), **4 Ereignisse** (vorhandene
Lock-Diagnosen und Testmeldungen). `--dashboard-view 2` startet direkt bei den
Queues. Der bisherige Startbefehl funktioniert weiterhin.

Der Test fragt einmal pro Sekunde über eine separate Admin-Verbindung
`debug_performance_stats` ab. Sie fordert keine Turnierübersicht an und legt
keine DB-Operation oder Lock-Aufgabe an. So warten Diagnoseantworten nicht
hinter einer großen Antwort der gemessenen Admin-Verbindung. Pro Test läuft
höchstens eine Diagnoseabfrage gleichzeitig; nach drei Sekunden läuft sie in
einen Timeout. Diese zusätzliche Verbindung und ihre Antworten zählen nicht
zu den Payload- oder Punktlatenzwerten; sie erhält auch keine Turnier-Changes.
Server und Testclient müssen für diese
Messung die aktuelle Version verwenden; ohne kompatible Telemetrie erscheint
`UNKNOWN` und der eigentliche Turniertest läuft weiter.

Die Queue-Messwerte sind **serverweit**, die Punktlatenzen beziehen sich auf das
Testturnier. Angezeigt werden wartende und laufende Aufgaben, älteste Wartezeit,
Eingangs- und Abschlussrate (einschließlich fehlgeschlagener Aufgaben), Änderung
der wartenden Anzahl über bis zu eine Minute und Verlauf über bis zu fünf
Minuten. Jeder Verlauf wird separat skaliert. `Peak` ist bei Locks/DB/Workern das
bisherige Maximum aus wartenden **plus laufenden** Aufgaben dieser Queue; es
ist nicht derselbe Wert wie die Spalte `Wait`. DB-Aufgaben gelten nach ihrem
Callback als abgeschlossen; NeDB kann den Executor erst im nächsten
Event-Loop-Durchlauf freigeben. Unbeobachtete DB-Collections werden nicht als
leere Queues ausgegeben. Worker werden erst nach ihrem ersten Auftrag sichtbar.

`WARN` erscheint bei länger als zehn Sekunden anhaltenden Wartezeiten über
eine Sekunde, wachsendem Rückstand über etwa 30 Sekunden oder anhaltender
Event-Loop-p95 über 100 ms. Die Empfangsmessung weist zusätzlich auf ausstehende
Punkte über eine Sekunde, p95 über 100 ms bei mindestens 20 Minutenproben oder
abgelaufene Zuordnungen hin. Das sind Diagnosegrenzen, keine Kapazitätsgarantie;
eine Warnung bei Hintergrundarbeit erfordert einen Blick auf Aufgabe und
Benutzerlatenzen. Einzelne Queue-Spitzen erzeugen keine Rückstauwarnung.
Telemetrie mit Antwortalter plus RTT über fünf Sekunden oder eine fehlgeschlagene Abfrage ergibt
`UNKNOWN`. RTT und Alter der Diagnoseantwort sind sichtbar.

Die Event-Loop-Messung nutzt 20 ms Auflösung und startet mit der ersten
Diagnoseabfrage; erst nach mindestens einer Sekunde gibt es Werte. Eine
ungehinderte Schleife liegt dabei ungefähr bei 20 ms. Nach zehn Sekunden ohne
Abfragen wird diese Messung abgeschaltet. Normale Server-Logs bleiben aus;
DB- und Worker-Zähler arbeiten unabhängig von ausführlichen Log-Einstellungen.
Die Ereignisansicht verwendet die schon vorhandenen letzten Lock-Aufgaben
(ab 100 ms Wartezeit, 500 ms Laufzeit oder Fehler) und `queue_hang_warning`.
Sie aktiviert keine zusätzlichen Logs und leitet keine rohe Konsolenausgabe um.

Gleichzeitige Admin-Abfragen der Vorbereitungsauswahl teilen ihre Berechnung
und JSON-Aufbereitung für höchstens 250 ms, solange alle beteiligten
DB-Dokumente unverändert sind. Jede Anfrage durchläuft weiterhin die
DB-Lesebarrieren; vorher eingereihte Änderungen an Spielen, Check-in, Feldern
oder Einstellungen werden vor einer Wiederverwendung berücksichtigt.
Zeitabhängige Hinweise in dieser Anzeige können bis zu 250 ms alt sein.
Die tatsächliche Aufrufautomatik berechnet ihre Auswahl weiterhin frisch.
Anfrage-IDs und Versandfolge bleiben je Admin-Verbindung getrennt.

Bei gleicher Spielzeit stehen Spiele mit positiver BTP-Position vor Spielen
mit Position 0 oder ohne Position. Letztere folgen nach Spielnummer. Diese
Sortierregel gilt für Anzeige und Aufrufautomatik; die gespeicherten und an BTP
übertragenen Positionswerte bleiben unverändert, einschließlich Position 0.

Beim Pausieren misst der Test, wann alle **wartenden** beobachteten Queues
mindestens drei Sekunden leer bleiben. Laufende Hintergrundaufgaben und neue
Syncs sind weiterhin möglich. Der JSON-Bericht und die abschließende Logzeile
enthalten unter `server_performance` die pro Serverlauf beobachteten Höchstwerte,
Diagnosefehler, letzte Messung, letzten Status, bis zu 50 Diagnoseereignisse und
das Ergebnis der letzten Pause. Nach einem Serverneustart beginnen Raten und
Verläufe neu. `reception_expired` enthält die kumulativen Zuordnungstimeouts.

Der Bericht erfasst außerdem den Ausgangsstand mit fertigen und aktiven Spielen,
offenen Check-ins und einem Hash des Spielstands. Ein fester Seed hält die
Zufallsfolgen je Spiel und Tablet unabhängig voneinander. Unterschiedliche
Ausgangsstände, automatische Feldbelegung und Serverlaufzeiten beeinflussen
weiterhin, welche Spiele laufen und wie viele Aktionen innerhalb einer Phase
stattfinden. Für Vergleiche daher neben den Latenzen auch Feldbelegung und
Aktionszahlen betrachten. Die Ruhephase pausiert die Eingaben des Clients;
zeitabhängige Änderungen und BTP-Syncs laufen auf dem Server weiter.

Mit `BTS_BTP_SYNC_TIMING=1` zeigt der Server bei `integrate_events_details`
zusätzlich `skipped: true`, wenn er unveränderte Disziplin- und Meldedaten
wiederverwendet. Die Prüfung berücksichtigt Spielerinformationen, Meldungen,
Vereine und Verbände sowie Spielanzahlen je Disziplin. Änderungen am gespeicherten
Disziplinpaket, einschließlich Turnier-Resets, verhindern das Überspringen.
Die Laufzeit des gesamten Schritts steht weiterhin bei `integrate_events`.

Der BTP-Abruf hält keinen Resource-Lock. Gleichzeitig ausgelöste Abrufe derselben
Verbindung teilen sich einen laufenden Abruf einschließlich seiner Integration.
Nach Empfang der Antwort berechnet der Server auf einem isolierten Datenstand
die Änderungen. Diese Planung hält ebenfalls keinen Resource-Lock. Erst für das
Schreiben wird `fetch_sync_apply` mit den betroffenen Ressourcen eingereiht:
geänderte Spiele, deren Felder und weitere Spiele, die dieselben Spieler enthalten
oder von der Feldänderung betroffen sind. Die bestehenden Locks für Vorbereitung,
Tabletbediener, Schiedsrichter und automatischen Aufruf sichern dabei die Vergabe.
Normale Punktmeldungen auf unabhängigen Spielen können weiterlaufen.

Disziplinpakete und Spielstätten besitzen eigene Locks. Änderungen an den
Turniereinstellungen und Wertungsformaten benötigen weiterhin den Turnier-Lock.
Vor dem Schreiben prüft der Server BTP-Aktivierung, Reset-Zeitpunkt und den
verwendeten Datenstand erneut. Bei zwischenzeitlichen Änderungen gibt er alle
Locks frei und berechnet einen neuen Plan; veraltete Antworten nach einem Reset
werden verworfen. Benachrichtigungen und BTP-Rückmeldungen erfolgen erst nach
erfolgreichen Schreibvorgängen. Der automatische Feldaufruf nach dem Sync nutzt
ebenfalls einen geprüften Plan mit gezielten Locks.

Reine Punktänderungen eines gesperrten, laufenden Spiels verwerfen den Plan nicht
mehr, wenn der Sync dessen lokale Punktdaten unverändert weiterführen wollte.
Unter den bereits gehaltenen Locks übernimmt er den neuesten Spielstand,
Seiten-/Aufschlagdaten, Tastendruckhistorie, Dauer und Federballzähler. Die
Schreibänderungen bleiben auf die vom Sync geänderten Metadaten beschränkt;
Benachrichtigungen und eine Rücknahme fehlgeschlagener Schreibvorgänge verwenden
den übernommenen Punktestand. Änderungen an Spielende, Vorbereitung, Feld,
Gegnern oder Wertungsformat sowie Rückmeldungen mit einem fest erfassten
Spielstand benötigen weiterhin eine Neuplanung.

Sind Antwort und relevanter lokaler Datenstand unverändert, entfällt das Einreihen
in die Resource-Queue vollständig (`reason: "no_sync_changes"`). Ausstehende
lokale Rückmeldungen, ablaufende Spielerpausen und Reparaturversuche für versteckte
Freilose verhindern dieses Überspringen. Auch hinzugefügte oder gelöschte
Datensätze werden erkannt. Nach einem Reset wird dieselbe Antwort neu geplant.

Bei `BTS_BTP_SYNC_TIMING=1` zeigt `btp_fetch:response_received` die Abrufzeit,
einschließlich der Decoder-Verarbeitung. `btp_fetch:response_decode` trennt
Dekomprimierung (`decompress`), UTF-8-Konvertierung (`utf8`), XML-Parsing
(`xml_parse`) und DOM-Umwandlung (`object_conversion`). Die kompakte JSON-Zeile
enthält die Dauer und Prozess-CPU-Zeit je Schritt, Antwortgrößen, Turnier und
Request-Aktion sowie reale Start-/Endzeitstempel zum Vergleich mit Punkt-Traces.
Netzwerkwarten und die nachfolgende Antwortverarbeitung sind darin nicht
enthalten. CPU-Zeit ist prozessweit und kann Hintergrundthreads/GC einschließen.
Details stehen in `bts/timing/README.md`.
Die Ausgabe `btp_sync:phase_timing` mit `phase: "incremental_plan"` zeigt die Planung einschließlich
`changes`, `match_locks` und der konkreten `locks`. `integration_lock_wait` misst
die Wartezeit, `incremental_apply` Schreiben plus Veröffentlichung/Cache und `total_incremental` den
gesamten Ablauf. Die bisherigen Phasen, einschließlich `phase: "total"`, beziehen
sich jetzt auf die Integration im isolierten Planungsstand. Die tatsächliche
Sperrdauer enthält zusätzlich die erneute Datenprüfung vor `incremental_apply`.
Die Planer-Ausgaben enthalten `task`, um BTP-Integration (`fetch_sync_apply`) und
anschließenden Feldaufruf (`post_sync_auto_call_apply`) zu unterscheiden.
`start_ts` und `ts` geben reale Zeitgrenzen an. `incremental_writes` misst die
DB-Schreibvorgänge, `incremental_publish` die Benachrichtigungen/Effects und
`incremental_cache` das Aktualisieren des Sync-Caches. Diese drei Phasen sind
in `incremental_apply` enthalten; nicht addieren. Alle bleiben innerhalb der
Ressourcen-Locks. Mit Score- oder Sync-Timing liegt die standardmäßige Schwelle
für `update_queue:slow_task` bei 50 statt 500 ms. Ein explizites
`BTS_UPDATE_QUEUE_SLOW_TASK_MS` überschreibt sie; `0` deaktiviert sie.
Die Queue-Zeilen nennen Aufgaben-ID, Score-Trace, reale Zeitgrenzen und den
zuletzt beobachteten Blockierer samt ID, Zustand und konkret kollidierenden
angeforderten Locks. Ein beobachteter Konflikt erklärt nicht automatisch die
gesamte Wartezeit; Scheduling kann zusätzlich beitragen.
Vor dem anschließenden Feldaufruf prüft `auto_call_precheck`, ob überhaupt ein
aktives Feld frei ist. Bei `reason: "no_free_courts"` entfallen Planung und
Resource-Queue. Nach einer validierten Planung ohne Änderungen können weitere
Aufrufe mit `reason: "unchanged_call_inputs"` ebenfalls entfallen. Änderungen
an Check-ins, Teilnehmern, Feldbelegung, Offiziellen und Einstellungen sowie
ablaufende Vorbereitungszeiten, Startzeitfenster und Pausen erzwingen eine neue
Prüfung. `next_check_ts` nennt die nächste Zeitgrenze; tatsächliche Zuweisungen
verwenden weiterhin die bestehende Validierung und die gezielten Locks.
`incremental_snapshot`, `incremental_refresh` mit `copied_records` und
`incremental_diff` messen das Lesen, das Aktualisieren des isolierten Datenstands
und das Ermitteln der Schreibänderungen getrennt. Unveränderte gespeicherte
Datensätze werden beim Lesen nicht kopiert und beim Vergleichen wiederverwendet.
`incremental_validate` zeigt die Prüfung unter den Locks.
`normalization_fingerprint_check` prüft die zwischengespeicherten Objekt-Hashes
für Spielerpausen und Offiziellen-Abgleich. Bei `skipped: true` wird kein
Setup-Snapshot gelesen und kein Objekt-Hash erneut berechnet. Normale Punkte
ändern diesen Hash nicht. `load_normalization_state` erscheint nur, wenn ein
Snapshot für die weitere Prüfung benötigt wird. Geänderte Eingaben durchlaufen
weiterhin die bisherigen Normalisierungen; Ablaufprüfungen für Pausen und
Freilosweitergabe bleiben aktiv.
Beim bestätigten Spielende erscheinen zusätzliche `score_phase`-Messungen:
`finish_cleanup_context`, `finish_cleanup_players`, `finish_cleanup_tablets`,
`finish_cleanup_officials`, `finish_cleanup_tablet_waitlist` und
`finish_cleanup_btp_courts`. Die bestehende Phase `finish_cleanup` misst weiterhin
die Gesamtdauer. Standardmäßig werden Phasen ab 100 ms ausgegeben;
`BTS_SCORE_PHASE_TIMING_MS=0` zeigt auch die kurzen Phasen. Spieler und
Tabletbediener werden über ihre Matchbeziehungen gelesen, ohne alle Spiele samt
Punktehistorien zu kopieren. Die Offiziellenphase wartet auf die abgeschlossenen
Datenbankänderungen und berücksichtigt andere aktive oder geplante Einsätze.
`integrate_matches_detail` zeigt mit `raw_incoming` alle BTP-Einträge und mit
`excluded_from_selection` die nicht eigenständig integrierbaren Einträge.
`incoming`, `selected` und `skipped_by_delta` beziehen sich nur auf integrierbare
Spiele. Ausgeschlossene Einträge bleiben im Abhängigkeitsgraphen erhalten;
die Verarbeitung und wiederholte Übertragung versteckter Freilose bleibt aktiv.
Bei einer Neuplanung nennt `incremental_replan` unter `mismatches` die Sammlung,
Anzahl und bis zu vier
Datensatz-IDs samt geänderten Feldpfaden je Sammlung; Feldwerte werden nicht
ausgegeben. Neue und gelöschte Datensätze erscheinen als `added` und `removed`.
`incremental_point_rebase` zeigt unter `matches` die Anzahl der Spiele, deren
zwischenzeitliche Punktänderungen ohne Neuplanung übernommen wurden, sowie bis
zu vier IDs unter `match_ids`. `incremental_validate` und `incremental_apply`
enthalten zusätzlich `rebased_matches`; erst eine erfolgreiche Validierung
erlaubt das Übernehmen. `total_incremental.attempts` zählt weiterhin vollständige
Planungsversuche.

Bei Punktmeldungen unterscheiden `load_context_match`, `load_context_tournament`
und `load_context_court` langsame Datenbankabfragen. Im Objektmodell-Leseweg nennen
sie `db_queue_wait_ms` (einschließlich Wartezeit auf den Event Loop), `read_ms`
(Lookup und Kopie), `queue_depth_at_enqueue` (wartende Aufgaben ohne die bereits
laufende Aufgabe) und `compaction_pending_at_enqueue` (automatische Kompaktierung
dieser Sammlung bereits eingeplant oder aktiv). `read_source` unterscheidet
`object_model` vom bisherigen `datastore`-Fallback. Die gemeinsame Phase
`load_context` enthält bei aktivierter Zeitmessung `first_event_loop_turn_ms`:
Zeit bis zum ersten `setImmediate` seit Beginn der Abfragen, keine Messung aller
späteren Event-Loop-Verzögerungen. `null` bedeutet, dass die Abfragen bereits vor
diesem Callback abgeschlossen wurden. Die drei Lesezeiten überlappen sich und
dürfen nicht addiert werden. Wie andere Punktphasen werden die Messwerte
erst oberhalb der eingestellten Schwelle protokolliert. Der Turnierkontext
lädt hierfür nur die Kennung und den Schwellenwert für die nächste Vorbereitung,
ohne Disziplin- und Meldedaten. Auch die BUP-v2-Pfade für Anzeige- und
Tabletaktualisierungen laden nur die benötigten Turniereinstellungen, Namen,
Sprache, Logo- und Debugdaten. Änderungen dieser Einstellungen werden bei der
nächsten Abfrage berücksichtigt; Disziplin- und Meldedaten werden dafür nicht
kopiert. Mit einem der beiden Timing-Flags protokollieren
`database:compaction_start` und `database:compaction_done` außerdem Sammlung,
Zeitpunkt, Laufzeit und Fehler der NeDB-Kompaktierung. Diese erfolgt auch beim
Laden der Datenbank; die automatische Wiederholung läuft weiterhin alle zehn
Minuten pro Sammlung zuzüglich der Laufzeiten der Kompaktierungen. Nach dem
Start werden die 13 Sammlungen über die ersten zehn Minuten verteilt, mit
mindestens rund 46 Sekunden Abstand. `bts/database_compaction.js` wartet auf den
Abschluss einer automatischen Kompaktierung, bevor der nächste Abstand beginnt;
langsame Schreibvorgänge erzeugen keinen Rückstau automatischer Kompaktierungen.
NeDBs Executor und sicheres Dateischreiben bleiben erhalten. Die beim Laden
notwendigen Kompaktierungen und ausdrücklich angeforderte Kompaktierungen,
etwa beim Bereinigen eines Turniers, gehören nicht zu diesem Zeitplan. Ein
einzelner großer Match-Datensatzbestand kann seine eigene Queue weiterhin
blockieren. Die Änderung verhindert die bisherige gleichzeitige automatische
Kompaktierung sämtlicher Sammlungen; der nächste Live-Test prüft die Auswirkung.

BUP-v2-Punkte nutzen standardmäßig einen direkten NeDB-Executor-Auftrag, der
zusätzliche Schleifendurchläufe des allgemeinen Updates spart. Schreibreihenfolge,
Validierung, Index-Hooks und Persistenz bleiben erhalten. Der Schalter
`BTS_SCORE_DIRECT_WRITES=0` aktiviert den bisherigen Weg; das Performance-Profil
nennt `score_direct_writes`. Ein isolierter Vergleich mit temporären Dateien ist
mit `node debug/score_write_benchmark.js` reproduzierbar. Messung und Grenzen
stehen in [der Auswertung von Test 13](performance_test13_2026-10-23.md).

Admin-Änderungen werden standardmäßig einmal in JSON und UTF-8 codiert und
anschließend als gemeinsamer Buffer an die getrennten Outboxes übergeben. Ihre
reservierten Antworten und die Reihenfolge bleiben je Fenster erhalten.
`BTS_ADMIN_BROADCAST_SHARED=0` aktiviert die bisherige Codierung pro Empfänger;
das Profil nennt `admin_broadcast_shared`, die Traces `admin_broadcast_encode`.
`node debug/admin_broadcast_benchmark.js` vergleicht beide Varianten mit
synthetischen Daten ohne Serverzugriff. Details und Messgrenzen stehen in
[der Auswertung von Test 15](performance_test15_2026-10-23.md).

Datastore-Aufträge stellen den beim Einreihen erfassten Prioritätsbesitzer
sowohl bei Ausführung als auch bei Callback-Zustellung wieder her. Auch ein
fehlender Besitzer wird ausdrücklich gesetzt; ein fremder Scheduler-Kontext
darf keine Punktpriorität übernehmen oder freigeben. Bei aktivierten Traces
misst `preparation_selection_dispatch` den Startaufwand und
`preparation_selection_turn` die einzelnen Rechenabschnitte der
Vorbereitungsauskunft. Kandidatensuche und Diagnose geben zwischen ihren
Arbeitsschritten die Ereignisschleife frei. Ältere Berichte verwenden
`preparation_selection_sync_start` für den damals ungeteilten Anfang
der Vorbereitungsberechnung. Der Start-Trace nennt außerdem `input_documents`.
Die gesamte Dauer der Vorbereitungsauskunft umfasst auch beabsichtigtes Prioritäts-Warten.
Reproduktion, Tests und verbleibende Grenzen stehen in
[der Auswertung von Test 17](performance_test17_2026-10-23.md) und
[der Auswertung von Test 25](performance_test25_2026-10-24.md).

Punktabfragen können jetzt auch eine vollständig beobachtete Warteschlange aus
reinen Lesern passieren. Frühere Writes und unbekannte oder TTL-fähige Aufgaben
bleiben Sperren; Punkte werden weiterhin vor ihrer Veröffentlichung gespeichert.
`BTS_SCORE_MODEL_READONLY_READS=0` deaktiviert den neuen Pfad, das Profil nennt
`score_readonly_reads` und die Kontextmessung `read_only_store`. Die Beobachtung
erfasst dazu die Queue-Freigabe nach dem Datastore-Callback. Messungen,
Funktionsprüfungen und Grenzen stehen in
[der Auswertung von Test 19](performance_test19_2026-10-23.md).

Die erste Durchsage synchronisiert jetzt eine noch unbekannte Kontextversion,
bevor sie ihre lokale Zusammensetzung erstellt. Fertige Kontext-Bausteine dürfen
nicht durch neue Einzeltext-Aufträge ersetzt werden, nur weil das Browserfenster
noch Startmetadaten hält. Änderungen an einem Spiel ohne Feld aktualisieren
außerdem gezielt die betroffenen V2-Anzeigen; V1-Pakete werden nur bei passenden
Empfängern aufgebaut. Reproduktion, Zeitstempel und Prüfungen stehen in
[der Auswertung von Test 21](performance_test21_2026-10-24.md).

Mit `BTS_SCORE_PRESS_TIMING=1` oder `BTS_BTP_SYNC_TIMING=1` beobachtet
`bts/database_tasks.js` zusätzlich die Datastore-Aufgaben, ohne ihre Reihenfolge
oder Callback-Ergebnisse zu ändern. In den Kontextphasen zeigen
`executor_at_enqueue` und `executor_before_read` die Anzahl laufender Aufgaben,
die aktive Aufgabe und die zuletzt abgeschlossene Aufgabe. Die Aufgaben-ID ist
je Datastore fortlaufend; `query_fields` nennt nur Abfragefelder, keine Werte.
`phase` unterscheidet `running`, `callback` und `awaiting_executor_release`.
Letzteres bedeutet, dass der Callback bereits zurückgekehrt ist, aber NeDBs
geplanter Queue-Freigabe-Callback noch nicht gelaufen ist. `queue_release_pending_ms`
nennt die Zeit seit Rückkehr des Callbacks; `callback_ms` dessen Laufzeit.
`before_callback_ms` umfasst die Arbeit und Wartezeit bis zum Callback, keine
isolierte CPU-Messung. `persistence` unterscheidet `append` und `compact`, mit
Laufzeit einschließlich Serialisierung, I/O und Event-Loop-Wartezeit sowie
`pending`. Die zuletzt abgeschlossene Aufgabe nennt außerdem
`callback_finished_ago_ms`. Ohne aktive Messung sind die Executor-Daten `null`.

Aufgaben ab 100 ms werden als kompakte Zeile `database:executor_task` ausgegeben,
mit Sammlung, Zeitpunkt, Aufgaben-ID, Laufzeiten und `storage_mode` (`file` oder
`memory`). Der Zeitpunkt ist der Abschluss des Callbacks, nicht die Queue-Freigabe.
Eine lange Aufgabe kann mehrere wartende Abfragen betreffen.
`load_context` misst während der gesamten Wartezeit zusätzlich die Verspätung
eines 20-ms-Timers: `event_loop_timer_max_delay_ms`, `event_loop_timer_samples`
und `event_loop_timer_interval_ms`. Auch ein beim Abschluss noch überfälliger
Timer wird berücksichtigt. Kleine Werte schließen kurze Unterbrechungen oder
asynchrone DB-Wartezeiten nicht aus; große Werte zeigen verzögerte Timer,
benennen aber noch nicht die verursachende CPU-Funktion.

Geräteinformationen innerhalb einer Punktmeldung werden in
`device_info_hostname`, `device_info_settings_read`, `device_info_tournament_read`,
`device_info_settings_insert`, `device_info_settings_update` und
`device_info_notify` aufgeteilt. Nur tatsächlich ausgeführte Schritte erscheinen.
Bei einer langsamen Gesamtverarbeitung werden alle zugehörigen Teilschritte mit
`parent_slow: true` ausgegeben, auch unterhalb der normalen 100-ms-Schwelle.
Die Laufzeiten enden am jeweiligen Teilschritt, obwohl die Ausgabe gesammelt
am Ende erfolgt; die Trace-ID bleibt die der Punktmeldung.
`hostname_cached` bedeutet, dass bereits ein Hostname oder eine laufende
Hostname-Promise am WebSocket vorhanden war; auch eine solche Promise kann
noch warten. Fehler werden mit dem betroffenen Schritt protokolliert und
im direkten Vergleichspfad an den Aufrufer gegeben. Mit
`BTS_DEVICE_INFO_BACKGROUND=0` werden Geräteinformationen weiterhin
abgewartet; die Teilschritt-Messung dient der Ursachenzuordnung. Die getrennt
schaltbare Entkopplung wird unten beschrieben.

Der harte Abruf-Timeout
endet nach dem vollständigen Decodieren der Antwort; Worker-Wartezeit zählt dazu,
Wartezeit auf Integrationslocks und Integration zählen nicht dazu.
Der nächste automatische Abruf wird erst nach Abschluss des laufenden Abrufs
einschließlich Integration oder Überspringen geplant. Fehlgeschlagene
Integrationen bleiben für den nächsten automatischen Abruf vorgemerkt.

Große BTP-Turnierantworten werden in einem wiederverwendeten Worker decodiert.
`btp_fetch:response_decode` nennt dafür `execution: "worker"`, `queue_wait_ms`,
`dispatch_ms`, `input_wait_ms`, `return_delivery_ms` und `decode_roundtrip_ms`.
Die Decoder-Zeitstempel beschreiben jetzt Worker-Arbeit und dürfen nicht als
Hauptthread-Blockade interpretiert werden. `return_delivery_ms` enthält Klonen,
Zustellung und Scheduling; es ist keine isolierte CPU-Zeit. Details in
`bts/btp_decode/README.md` und `bts/timing/README.md`.

Ein separater Offline-Vergleich ohne Server-/DB-Zugriff ist wiederholbar mit:

```bash
node debug/btp_decode_benchmark.js > /tmp/bts-worker-offline-benchmark.json
```

Er prüft gleiche Decoder-Ergebnisse und misst die Verzögerung eines 2-ms-Timers
während direkter bzw. ausgelagerter Decodierung. Die künstlichen Daten ersetzen
den Live-Benchmark nicht; der erste Worker-Aufruf wird separat ausgewiesen.

Ein synthetischer Vergleich mit 519 Spielen steht in `performance_runs.json`
unter `incremental_sync_plan`. Bei einer geänderten Spielvorbereitung sank die
mittlere Sperrdauer von 103 auf 12 ms; acht abhängige Spiele wurden gesperrt.
Die zusätzliche Planung erhöhte die gesamte Laufzeit von 113 auf 228 ms.
Der Vergleich verwendet separate Datenbanken im Speicher und misst keine
Tablet- oder TV-Latenzen; diese müssen im Live-Test verglichen werden.

Der nachfolgende synthetische Vergleich `sync_copy_reduction` verwendet 519
Spiele, 20 Disziplinen, 310 Spieler und 40 gespeicherte Verläufe mit je 180
Tastendrücken. Mit der reduzierten Kopierarbeit sank die mittlere gesamte
Sync-Laufzeit von 135 auf 87 ms, bei unveränderten Antworten von 19 auf 11 ms.
Beide Varianten erzeugten identische gespeicherte Spiele und erhielten sämtliche
Verläufe. Auch diese Werte ersetzen keine Live-Messung.

Logs und Bericht werden bei einem erneuten Lauf überschrieben. Für aufzubewahrende
Vergleichsläufe andere Dateinamen verwenden, zum Beispiel:

```bash
npm run debug:benchmark -- --plain-log --report /tmp/bts-benchmark-run2.json 2>&1 | tee /tmp/bts-live-drill-run2.log
```

## Automatischer Test mit einem Befehl

Standardmäßig läuft einmal das Profil `combined-responsive-background-admin`.
Es aktiviert vorbereitete Turnier-Writes und kooperative Admin-Antworten mit
Punktpriorität zusätzlich zu den bisherigen Responsiveness-Schaltern.
Gebündelte Sync-Writes bleiben aus. Vorhandene Referenzläufe werden nicht wiederholt:

```bash
npm run debug:benchmark-sequence
```

Vorher den bisherigen Testclient und `make dev` einmal mit `Strg+C` beenden.
Der Ablauf startet BTS direkt mit Node ohne Dateiwächter, prüft das tatsächliche
Serverprofil und die 519 Spiele über den Admin-WebSocket, wartet zehn Sekunden
vor der Last und führt den Benchmark mit demselben Seed aus. Das dauert rund
10 Minuten plus Start- und Wartezeiten. Das Turnier läuft weiter; der Ablauf
setzt nichts zurück und checkt keine Spieler zusätzlich zum Testclient ein.

Alle Dateien landen in einem neuen `/tmp/bts-offload-sequence-*`-Verzeichnis:

- `01-combined-responsive-background-admin-server.log`, `01-combined-responsive-background-admin-client.log`, `01-combined-responsive-background-admin-report.json`
- `sequence.json` mit erwarteten/tatsächlichen Profilen, Prozesskennungen,
  Laufstatus, Berichtswegen und Ergebnissen

Fortschritt wird alle 30 Sekunden angezeigt. `Strg+C` bricht ab; anschließend
werden nur die eigenen Kindprozesse beendet. Ein vorhandener Server wird
nicht übernommen oder beendet. Startfehler, unvollständige Berichte oder
Profilwechsel brechen die Sequenz ab. Auch nach erfolgreichem Abschluss wird
der vom Ablauf gestartete Server beendet. Bestehende Ausgabeordner werden
nicht überschrieben.

Den geplanten Ablauf ohne Prozesse oder Dateischreibzugriffe ansehen:

```bash
npm run debug:benchmark-sequence -- --dry-run
```

Bei Bedarf einzelne Profile automatisch vergleichen:

```bash
npm run debug:benchmark-sequence -- --profiles basis,device-info,sync-plan,compaction
```

Weitere Optionen: `--base-url`, `--tournament`, `--output-dir`, `--seed`,
`--expected-matches`, `--warmup-ms` und `--ready-timeout-ms`; Details mit
`--help`. Die Basis lässt den Decoder-Worker an, alle vier neuen Schalter aus.
`combined` schaltet nur Planung, Geräteinfos und Kompaktierung an. XLSX bleibt
aus, weil der Live-Test keine Imports durchführt; dafür existiert der Offline-Test.
Vererbte Schalter werden explizit überschrieben.

Die Profile `combined` und `combined-patches` aktivieren Planung, Geräteinfos
und Kompaktierung. Nur
`combined-patches` setzt zusätzlich `BTS_SYNC_PLAN_PATCH_RETURN=1`.
`combined-reads` setzt dieselben Schalter wie `combined-patches` plus
`BTS_COMPACTION_MODEL_READS=1`. Die anderen Profile setzen diesen Schalter
explizit auf `0`, außer `combined-preparation` und `combined-responsive`. `combined-preparation` setzt dieselben Schalter wie
`combined-reads` plus `BTS_PREPARATION_MODEL_READS=1` setzt. Alle übrigen Profile
setzen den Vorbereitungs-Schalter explizit auf `0`, auch bei vererbtem Shell-Wert.
`combined-responsive` ergänzt `combined-preparation` um
`BTS_PREPARATION_CANDIDATES_LIGHT=1`, `BTS_SYNC_BATCH_WRITES=1` und
`BTS_COMPACTION_STAGED=1`. Die neueren Responsiveness-Profile behalten Kandidatenauswahl und vorbereitete
Kompaktierung bei und setzen Batch-Writes auf `0`. Die übrigen Profile setzen
diese Schalter zurück.
`basis` und `combined` behalten die bisherige vollständige Rückgabe, auch wenn
der neue Schalter in der Shell gesetzt ist. Alle Sequenzprofile verwenden
dieselbe Queue-Diagnoseschwelle von 50 ms. Der Client protokolliert jetzt bereits
TV-Latenzen über 100 ms mit Trace-Kennung. Das ändert die Lastsequenz nicht.
Die Berichte halten sämtliche Schalter fest. Details und Offline-Vergleich
stehen in `bts/offload/README.md`.

Der Vergleich mit dem archivierten Lauf verwendet dessen bereits gemessene
Werte. Die Profile `combined-patches`, `combined-reads` und `combined-preparation` verwenden die
genauere Queue-Diagnose. Erfolgreiche Modell-Reads während Kompaktierung
erscheinen als `database:compaction_model_read`. Langsame Kontext-Reads enthalten
ebenfalls `compaction_read_bypassed` und `compaction_read_decision`. Bei früheren
Writes oder unbekannten Aufgaben bleibt die Reihenfolge wichtiger als ein
schneller Read. Die getrennten Timing-Operationen helfen bei der Diagnose.
Unterschiedlicher Turnierfortschritt,
Feldbelegung und Check-ins bleiben Vergleichsbedingungen und werden berichtet.

`preparation:timing` trennt Datenlesen, Bedarfsprüfung, Kandidatenberechnung,
Auflösung einer Selbstblockierung und tatsächliche Vorbereitung-Aufrufe.
Die neue Variante vermeidet die Kopien der Match-/Feldobjekte zunächst nur bei
der Bedarfsprüfung; echte Kandidatenauswahl und Aufrufe verwenden ihre bisherigen
Wege. Neue Timing-Diagnose erzeugt zusätzliche Kosten, die beim Vergleich mit
älteren Läufen berücksichtigt werden müssen.

## Performanceziel und Testbericht

Praktische Abnahmeziele für Punkte sind Tablet bis TV p95 unter 50 ms und p99
unter 100 ms, einschließlich Syncs und Spielenden. Wiederkehrende Ausreißer über
100 ms sollen nach Ursache bewertet werden. Diese Werte sind Projektziele,
keine allgemeine Wahrnehmungsgrenze. Die Simulation misst den Empfang des
passenden Spielstands am TV-Testclient; echte Tablets/TVs sollten abschließend
ebenfalls geprüft werden.

Der Benchmarkbericht enthält jetzt echte p99-Werte, counts `over_50_ms`,
`over_100_ms`, `over_200_ms` und eine globale `tablet_to_tv_ms`-Statistik aus
allen Rohmesswerten des Laufs. Diese ergänzen die Werte je Phase. Globales p95
oder p99 wird nicht aus Phasen-Perzentilen gemittelt. Fehlende Zuordnungen bleiben
über `coverage` und `unmatched_updates` sichtbar.

Für Aufrufe ist zusätzlich zu prüfen, ob sie wegen Syncs an unbeteiligten
Spielen warten. Änderungen an denselben Ressourcen benötigen weiterhin kurze
Konsistenz-Locks. Vorbereitung und TV-Veröffentlichung sind die nächsten
gemessenen Ansatzpunkte; weitere Umbauten sind erst bei verbleibenden
Ausreißern sinnvoll. Der Punkt-Benchmark liefert noch keine vollständige
Ende-zu-Ende-Messung manueller Aufrufe, sondern nur Queue-/Phasen-Diagnosen.

## Auslagerungen einzeln vergleichen

Die zusätzlichen Auslagerungen sind implementiert und standardmäßig aus.
Schalter, Datenfluss und Messgrenzen stehen in
[bts/offload/README.md](../bts/offload/README.md).
Der bisherige Decoder-Worker bleibt standardmäßig an und lässt sich mit
`BTS_BTP_DECODE_WORKER=0` für einen eigenen Vergleich abschalten.

Für die Zuordnung zu einer einzelnen Änderung erst eine Basis mit Decoder-Worker
messen, dann je Lauf genau **einen** weiteren Schalter ändern. Das lässt sich mit
dem Ablauf oben automatisieren oder manuell ausführen. Server jeweils mit dem
gewünschten Profil neu starten; keine Quelländerungen während eines Laufs.
Beispielsweise als Basis:

```bash
BTS_PERF_RUN_LABEL=decoder-only BTS_BTP_DECODE_WORKER=1 BTS_SYNC_PLAN_WORKER=0 BTS_DEVICE_INFO_BACKGROUND=0 BTS_XLSX_IMPORT_WORKER=0 BTS_COMPACTION_WORKER=0 BTS_DEBUG_OUTPUT=1 BTS_SCORE_PRESS_TIMING=1 BTS_BTP_SYNC_TIMING=1 make dev 2>&1 | tee /tmp/bts-server-decoder-only.log
```

Testclient in einem zweiten Terminal:

```bash
npm run debug:benchmark -- --base-url https://localhost:4433 --tournament default --dashboard --report /tmp/bts-report-decoder-only.json 2>&1 | tee /tmp/bts-live-drill-decoder-only.log
```

Danach dieselben Befehle mit eigenem Label und Dateinamen ausführen:

| Versuch | Einzige Änderung gegenüber der Basis |
| --- | --- |
| `device-info` | `BTS_DEVICE_INFO_BACKGROUND=1` |
| `sync-plan` | `BTS_SYNC_PLAN_WORKER=1` |
| `compaction` | `BTS_COMPACTION_WORKER=1` |
| `xlsx-import` | `BTS_XLSX_IMPORT_WORKER=1`; braucht einen XLSX-Import als Last. |

Andere neue Schalter jeweils wieder auf `0` setzen. Der Bericht speichert
`server_offloading`, alle beobachteten `server_profiles` und
`mixed_server_profiles`; Server-Logs enthalten das Profil pro neuer Operation.
Gemischte Profile separat behandeln. Punkt-/TV-Latenzen, Sync-Gesamtdauer,
Planungszeit, Lock-Wartezeit, Timer-Verzögerungen und Kompaktierungsdauer getrennt
vergleichen. Weniger Timer-Verzögerung muss nicht kürzere Gesamtdauer bedeuten.
Der weiterlaufende Turnierstand, freie Felder, Check-ins und tatsächliche
Operationen bleiben zusätzliche Vergleichsbedingungen. Ohne Kompaktierung bzw.
XLSX-Import sagt ein Lauf wenig über deren Auslagerung aus.

Der wiederholbare Offline-Vergleich für alle vier Varianten:

```bash
node debug/offload_benchmark.js > /tmp/bts-other-offloads-benchmark.json 2> /tmp/bts-other-offloads-benchmark.err
```

## Isolierter Vergleich bis zum WebSocket-Empfang

Diese Diagnose benötigt keinen laufenden BTS-Prozess. Sie öffnet nur temporäre
Dateikopien des angegebenen Datenordners, prüft die Quelle per SHA-256 und nutzt
örtliche WebSocket-Empfänger in getrennten Prozessen. Keine Verbindung zu BTP,
echten Tablets, TVs oder Lautsprechern; kein Reset oder Live-Check-in.

```bash
npm run debug:isolated-transport -- --source /tmp/bts-isolated-sync-Xi6nEx/snapshot
```

Standard: vorbereitete Turnier-Writes aus/an, je 12 Messpaare + 2 Warmups für
Metadatenänderung, Registrierungsänderung und Kontrolle ohne Sync. Einzelwrites
und zurückgestellte fertige Historien in beiden Varianten. Fortschritt pro Paar;
Bericht in einem neuen `/tmp/bts-isolated-transport-*/report.json`.

Weitere getrennte Vergleiche, z. B. mit `--samples 8`:

- `--optimization admin-response`: JSON-Worker zusätzlich zu vorbereiteten Writes.
- `--optimization admin-response-cooperative`: kooperatives Kopieren/Encoding.
- `--optimization admin-response-priority`: nur Punktpriorität zusätzlich zur
  kooperativen Antwort; diese Variante ist jetzt Standard im Server.

Die Admin-Vergleiche verwenden drei Empfängerprozesse und senden Punkt/Aufruf
30 ms nach Beginn der Adminlast, um deren Verarbeitung zu überlappen.
Empfang wird vor JSON-Parsing gemessen; `request_to_receive_ms` beginnt beim
tatsächlichen Senden. Eine feste Überlappung ist kein Beleg für alle Ankunftszeiten.
Der Punkt ist ein persistierter Testmarker mit echten Kontext-Reads/Locks und
Score-Benachrichtigung; kein kompletter BUP-Punkt. Der Aufruf benutzt den echten
manuellen Handler, keine Feldvergabe. Keine Browser-Frame-/Audio-Messung.

Ergebnisse, Quellen und Einschränkungen stehen in
[performance_isolated_sync_2026-10-11.md](performance_isolated_sync_2026-10-11.md).

## Alter und aktueller Server: Sync gegen echten Spielaufruf

```sh
npm run debug:queue-check
```

Vergleicht die alte globale Queue und den aktuellen Scheduler auf eigenen
synthetischen Turnieren mit 519 Spielen. Vier Szenarien: kein Sync, verzögerte
BTP-Antwort, 518 geänderte Spiele und unveränderte Daten. Echte Feldvergabe und
freie Durchsage bis zum WebSocket-Empfang; Wartezeiten, konkrete Lock-Blocker,
DB-Arbeit und vollständiges Leeren der Queues werden exportiert. Kein laufender
Server erforderlich, keine Änderung am Live-Turnier. Details und Grenzen:
[queue_responsiveness.md](queue_responsiveness.md); Messergebnisse:
[performance_queue_2026-10-11.md](performance_queue_2026-10-11.md).

## Dateiarbeitspool der Sprachverwaltung

```sh
node debug/speech_io_isolation_benchmark.js
```

Vergleicht Worker-Thread und Sprachprozess mit synthetischen Cache-Schreibvorgängen
und kontrollierter Belegung eines libuv-Pools. Echte NeDB-Appends auf temporären
Dateien werden nach erneutem Laden überprüft. Keine Verbindung zu BTS, BTP oder
Sprachserver. Der absichtlich begrenzte Pool belegt die Trennung; daraus folgt
keine Zuordnung von Live-Ausreißern zur Sprachausgabe. Details:
[performance_test11_2026-10-23.md](performance_test11_2026-10-23.md).
