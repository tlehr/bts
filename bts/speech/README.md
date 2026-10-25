# Ansagen im eigenen Prozess

Bei aktivierter lokaler Sprache läuft die Ansageverwaltung standardmäßig in
einem langlebigen Node.js-Kindprozess. Er verwaltet Textplanung, Prioritäten,
Sprachserver-Aufträge, Polling, Inventar, Cache-Prüfung und Persistenz sowie
Audioabruf, WAV-Aufbereitung und HTTP-/HTTPS-Auslieferung. Die einzige
Verbindung zum Hauptprozess sind Steuerungsnachrichten und benötigte
Turnierdaten. Audiodaten werden weder über `postMessage` noch über den
BTS-Hauptserver transportiert. Der Kindprozess besitzt auch einen eigenen
libuv-Dateiarbeitspool. Ein Worker-Thread teilt diesen Pool mit dem Hauptprozess;
Cache-Schreibvorgänge konnten daher trotz getrennter JavaScript-Threads mit
Spielstand-Schreibvorgängen konkurrieren. Die
[libuv-Dokumentation](https://docs.libuv.org/en/v1.x/threadpool.html) beschreibt
diese prozessweite gemeinsame Nutzung. CPU und Datenträger des Rechners werden
weiterhin gemeinsam verwendet.

## Daten und Sperren

`snapshot.js` liest die aktuellen Modellrevisionen über Referenzen. Es öffnet
keine NeDB-Abfragen, reiht keine Datenbankarbeit ein und verwendet keine
Turnier-/Matchlocks. Die Ansagevorbereitung darf einem Turnierwechsel kurz
nachlaufen; die tatsächlich ausgelösten Texte bleiben für die Wiedergabe
maßgeblich. Der Worker schreibt ausschließlich in seinen Ansagecache.

Eine im Punkt-Trace gemessene DB-Wartezeit ist deshalb kein Beleg für eine
Turnierdatenbanksperre durch Sprache. Auch ein asynchroner Dateiappend bleibt
für NeDB aktiv, bis der Hauptprozess seinen Abschluss-Callback ausführt.
CPU-Konkurrenz kann dessen Ausführung verzögern; der eigene Audiocache kann
zusätzlich denselben physischen Datenträger beanspruchen. Die Prozesse teilen
keinen libuv-Arbeitspool, aber weiterhin Hardware-Ressourcen. Das ist getrennt
von einem Sprachauftrag in der Turnier-Datenbankwarteschlange zu messen.

`test_speech_worker.js` hält für eine Gegenprobe sämtliche Turnier-Datastore-
Executoren an und lässt weitere Enqueue-Versuche fehlschlagen. Im isolierten
Test gelingen dennoch ein neuer Planungssnapshot und die vollständige
Generierung einschließlich Cache-Persistenz und Fertigmeldung. Das prüft die
Datenbanktrennung funktional; es misst keine Live-Latenz unter TTS-CPU-Last.

Normale JavaScript-Objekte lassen sich zwischen den getrennten Prozess-Heaps
nicht als Pointer teilen. Deshalb werden nur geänderte Revisionen und gelöschte
Kennungen über IPC übertragen, jeweils höchstens 16 Datensätze pro Paket. Unveränderte
Objekte werden im Worker als Referenzen weiterverwendet. `WeakRef` im
Hauptthread erkennt unveränderte Revisionen, ohne alte vollständige Spiele samt
Historien am Leben zu halten. Punktverläufe und andere für Ansagen unnötige
Matchdaten werden überhaupt nicht übertragen. Die Pakete geben zwischenzeitlich
den Event Loop frei und warten bei aktiver Punktveröffentlichung.

Spielaufrufe übermitteln nur die kleine aktuelle Spielbeschreibung. Die bisher
im Benachrichtigungspfad ausgeführte Textberechnung findet im Worker statt.
Andere Planänderungen werden je Turnier gebündelt. Die Ein-Auftrag-Regel des
Sprachservers, Prioritäten und der persistente Cache bleiben erhalten.
Planungs-, Queue- und Inventarantworten verwenden am Admin-WebSocket die
vorhandene kooperative Hintergrund-Kodierung mit Punktpriorität. Für Diagnosen
enthält der Performance-Snapshot `speech.execution`, die Prozess-/Threadkennung,
offene Anfragen und die Anzahl/Dauer der IPC-Sendeschritte. Aktivierte Traces
erfassen `speech_request`, `speech_snapshot`, `speech_snapshot_collect` und
`speech_bridge_send`; Wartezeiten auf Punktpriorität sind von den kurzen
synchronen Sammel- und Sendeschritten zu unterscheiden. Texte und Zugangsdaten
werden dabei nicht protokolliert.

## Direkter Audioanschluss

Der Browser erhält weiterhin signierte relative Audiopfade über den vorhandenen
Admin-WebSocket. `speech.audio_endpoint` nennt zusätzlich den Anschluss des
Workers. `static/js/speech_service.js` ruft sowohl beim Audioelement als auch bei
Web-Audio genau diesen Anschluss auf. Cache-Status, Bereitschaft und Einstellungen
bleiben auf der bisherigen WebSocket-Verbindung; die Audioanfrage selbst geht
direkt zum Worker.

Standard ist derselbe Host mit **BTS-Port + 1**: HTTP 4000 → 4001 bzw. HTTPS
4433 → 4434. Der Worker liest bei HTTPS die bereits konfigurierten BTS-Zertifikate
selbst. Bei `speech.audio_port: 0` bzw. einem BTS-Testport 0 vergibt das
Betriebssystem einen freien Port. Ein fester Port kann mit `speech.audio_port`
oder `BTS_SPEECH_AUDIO_PORT` eingestellt werden.

Dieser Audioport muss vom Browser erreichbar sein; im Dockerbetrieb beispielsweise
zusätzlich `-p 4001:4001` veröffentlichen. Bei einem Reverse Proxy kann
`speech.audio_origin`, etwa `https://audio.example.org`, auf dessen direkt zum
Worker gerouteten Ursprung zeigen. Auch eine Route für `/h/.../speech/audio/...`
am vorhandenen HTTPS-Ursprung darf direkt zum Worker gehen. Der Proxy darf den
Audioweg nicht über den Node.js-Hauptserver führen. Unterschiedliche externe
Portzuordnungen benötigen eine passende `audio_origin`.

Der Anschluss bietet Audio sowie die authentifizierten Endpunkte für
[weitere Sprachhelfer](../../docs/speech-helpers.md) an. Die Helfer übertragen
Laufzeit, reguläre Kontextaufnahmen und Testaufnahmen direkt über diesen Prozess;
ihre Steuerung bleibt auf dem vorhandenen Admin-WebSocket. Freie kompatible
Helfer übernehmen kurze Quellen aus derselben priorisierten Warteschlange.
Die zentrale Qualitätsprüfung, Zuschnitt und Aufbereitung bleiben beim
Sprachserver. Ausfälle geben Arbeit für andere Helfer oder den lokalen Server
frei; Leases und vorgemerkte Aufträge werden im Sprachprozess gespeichert.
HMAC-Berechtigungen, Ablaufzeit, Range-/ETag-
Verarbeitung, Downloadgrenzen und Cache-Header der regulären Audioausgabe bleiben erhalten. CORS erlaubt
den direkten Abruf durch Web Audio ohne Cookies oder Sprachserver-API-Key.
Der Hauptserver bietet im Workerbetrieb keinen Audio-Proxy mehr an.

## Ausfall und Betrieb

Die Sprachplanung unter `/admin/t/<Turnier>/speech-planning/` bietet eine
Übersicht mit Bearbeitungsreihenfolge, Disziplinen und Begründungen, ein
umschaltbares Zustandsdiagramm und den Reiter **Spiele**. Die Ansichten zeigen denselben Live-Stand;
Bereichs- und Tabellenauswahl bleiben beim Umschalten erhalten. Die gewählte
Ansicht wird im Browser gespeichert. Das Diagramm nutzt seinen vorhandenen
Bereich mit vollständigen Verbindungen und eigenen Anfangs- und Endpunkten
pro Unterablauf. Die Seitenbreite bleibt begrenzt.
Vertikal scrollt ausschließlich die Seite; Diagramm, Queue, Entscheidungsweg
und Bereichsliste besitzen keine eigenen Scrollbereiche. Tabellen wechseln bei
weniger als 560 Pixeln verfügbarer Breite zu beschrifteten Phasen untereinander.
Dadurch bleiben alle Angaben ohne zusätzliche horizontale Scrollbalken lesbar.
Wie im Entwurf werden die einzelnen Vorbereitungsbereiche durchgehend
nummeriert; die Gruppenüberschriften bleiben ohne Nummer. Übersicht,
Diagramm und Generierung verwenden dieselbe feste Reihenfolge: Die
Vorbereitung angemeldeter Disziplinen bleibt auf 10, die Anmeldevorarbeit auf
11, auch vor der ersten Auslosung. Zusätzliche konkrete Anfragen erscheinen
ohne eigene Bereichsnummer und verschieben diese Nummerierung nicht.
Die Anmeldung gehört immer zum Vorrat nach den Spielbetriebsbereichen;
fertige Bereiche und Bereiche ohne Bedarf werden übersprungen.

Rechts steht die tatsächliche Queue einschließlich Quellabhängigkeiten und
Wiederholungsfristen. Über die Begründung eines Auftrags lässt sich dessen
Bereich beziehungsweise Disziplin und Phase auswählen. Die Ansicht fragt nur
Planungs- und Queue-Metadaten ab, startet keine Generierung und lädt weder
Audio noch einen Wiedergabeclient. Verbindungsausfälle machen den Stand
ausdrücklich unbekannt; nach dem Wiederverbinden wird neu geladen.

Sobald das aktuelle Generierungsinventar abgeglichen ist, darf die Queue neue
Aufträge übernehmen. Die anschließende Berechnung und Speicherung der
Spielübersicht blockiert dieses Nachfüllen nicht. Zusätzlich hält der Broker
höchstens einen wartenden Auftrag je Generator bereit: einen für den lokalen
Sprachserver und je einen für die verbundenen kompatiblen Helfer, insgesamt
höchstens 32. Die dazugehörigen abhängigen Ausschnitte erscheinen ebenfalls in
der Queue. Dieser kleine Vorrat überbrückt den nächsten Planaufbau; neue
Inventarteile warten währenddessen auf den aktualisierten Plan. Tatsächliche
Durchsagen und der aktuelle Spielbedarf behalten Vorrang. Die Zahl gleichzeitig
ausgeführter Aufträge und die freigegebenen CPU-Ressourcen ändern sich dadurch
nicht.

Der Reiter **Spiele** zeigt alle tatsächlichen Spiele einschließlich beendeter
Spiele in der normalen Spielplanreihenfolge (`cmp_scheduled_match_order`),
unabhängig von ihrer Generierungspriorität. Er zeigt für jedes Spiel die
eindeutigen fertigen und fehlenden Bausteine sowie getrennte Status für
Spielaufruf, Vorbereitung, Spielbeginn und weitere Aufrufe. Ein aufgeklapptes
Spiel zeigt die konkreten Durchsagen einschließlich Team-/Sieger- und
Hallenversionen sowie die einzelnen Bausteine. Ohne feste Feldzuweisung prüft
die Spielansicht die Bausteine für alle möglichen aktiven Felder. Bei bekanntem
Spielort sind das dessen Felder, ansonsten alle aktiven Turnierfelder. Dazu
gehören auch die Feldvarianten von Vorbereitung, Zweitaufrufen und Spielbeginn.
Sind sie vollständig, bleibt der Audiostatus trotz offener Feldwahl **Bereit**.
Nach der Zuweisung zählen nur noch die Varianten des konkreten Feldes.

Mit den modularen V2-Bausteinen können auch offene Begegnungen **Bereit** sein:
Die Ansicht prüft dafür alle bekannten Spieler beziehungsweise vollständigen
Paarungen der Disziplin einschließlich der benötigten Namenspositionen. Der
Teilnehmerbestand muss vollständig geladen sein; Reserve und ausgeschlossene
Meldungen gehören nicht zum ausgelosten Feld. Die Berechnung sagt keine
Ergebnisse oder möglichen Gegner voraus und erzeugt keine erfundenen Paarungen.
Die Details kennzeichnen diese Prüfung als **Alle Teilnehmer der Disziplin**.
Der tatsächliche Spielstatus bleibt beispielsweise **Teilnehmer offen**.
Bei V1 hängen Spielblöcke vom konkreten Gegner ab; dort reicht ein Vorrat
einzelner Namen nicht zum Nachweis einer vollständigen Durchsage.

Fehlt tatsächlich ein Baustein, zeigt die Ansicht den fehlenden, wartenden,
laufenden oder fehlgeschlagenen Auftrag. Reichen die Angaben nicht für eine
Prüfung, steht der konkrete Grund dabei, etwa unbekannte Teilnehmer oder ein
nicht im Plan vorhandenes Feld. Varianten für nicht zugewiesene Offizielle
werden nicht ergänzt. Die Summen pro Spiel umfassen alle geprüften Varianten;
sie sind keine Schätzung der Renderzeit und können nach einer konkreten
Feld- oder Teilnehmerzuweisung kleiner werden.

Der Plan für die Spielansicht wird aus jedem gelesenen Turnierstand
veröffentlicht, auch wenn neue Änderungen die weitere Generierungsplanung
überholen. Status und Feldzuweisungen warten dadurch nicht auf das vollständige
Aufbereiten des Hintergrundinventars. Die Veröffentlichung erzeugt keine
Audioaufträge und schreibt keine Cache-Metadaten.

`speech_games` liest ausschließlich diesen vorhandenen Plan und die
verifizierte Audioverfügbarkeit im Sprachprozess. Nur bei sichtbarem Reiter
werden diese Daten abgefragt. Details werden für ein ausgewähltes Spiel
übertragen. Gemeinsame Bausteine werden je Abfrage einmal geprüft; zwischen
je 24 Spielen wird der Event Loop freigegeben. Eine Inhaltsrevision vermeidet
das erneute Übertragen unveränderter Spielzeilen. Der Browser behält die
vorhandenen Zeilen und offenen Details und ändert nur betroffene Inhalte.
Suche und Reiterwechsel verändern weder den Plan noch die Generierungsqueue.

Spielzustände sind separat vom Audiostatus markiert. Vorbereitung nutzt die
Hervorhebungsfarbe der Hauptansicht (standardmäßig Lila), laufende Spiele
Gelb und Aufrufkandidaten Blau. Die Kandidaten stammen aus derselben Auswahl
wie der Prioritätsbereich. Feldnummern erscheinen mit dem bekannten
Spielfeldsymbol, auch bei beendeten Spielen. Die Vorbereitungsdauer folgt
der BTS-Uhr einschließlich Testmodus; bei einer angehaltenen Uhr steht auch
der Zähler. Der Filter **Nicht beendet** umfasst alle Zustände außer beendet.

Die zentrale [Diagnose und Fernaktualisierung](../diagnostics/README.md)
erfasst auch Warnungen des Sprachprozesses und Browser-Fallbackgründe.

Ausfälle des Sprachprozesses und ein belegter Audioport bremsen keine Turnieroperationen.
Offene Steuerungsanfragen erhalten `speech_unavailable`; im Automatikmodus ist
der Browser-Fallback weiterhin verfügbar. Der Worker startet nach einer Sekunde
neu und erhält Einstellungen und Daten erneut. Der Signierschlüssel bleibt
bei einem Worker-Neustart erhalten; fertige WAVs und Metadaten werden aus dem
Diskcache wieder eingelesen. Ein vollständig neuer BTS-Prozess erzeugt wie
bisher neue Audio-Berechtigungen.
Beim Ende oder Absturz des BTS beendet die getrennte Sprachverwaltung sich
über den geschlossenen IPC-Anschluss. Konfiguration und Signierschlüssel werden
über diesen privaten Anschluss übermittelt, nicht als Kommandozeilenargumente.

Aussprachekorrekturen werden im Worker in derselben ID-Reihenfolge wie bei der
Datenbankabfrage im Browser angewendet. Auch live hinzugefügte Korrekturen
behalten diese Reihenfolge. Das ist bei überlappenden Regeln entscheidend,
damit der fertige Sprachvorrat genau die später angeforderten Texte enthält.

Fehler der Worker-Brücke werden an den Übergängen abgefangen, statt in
Turnieränderungen oder Server-Callbacks durchzuschlagen. Ein Fehler beim Start
der Ansagenverwaltung lässt den BTS ebenfalls weiterlaufen. Fehler des Workers,
der Planung, des Sprachservers, der Aufbereitung und des Caches erscheinen
unabhängig von der Diagnoseeinstellung im Terminal mit Ursache und Stacktrace.
Erwartete Verbindungsfehler zum Sprachserver werden verständlich mit Adresse,
Ursache und Handlungshinweis gemeldet, ohne Crash-Stacktrace. Prüfungen von
Bereitschaft und Stimmen teilen sich dabei eine Meldung pro Adresse und Ursache.
Bei einer lokalen Adresse erklärt sie, dass der Sprachserver separat gestartet
werden muss und `make dev` nur BTS startet. BTS startet den Dienst nicht selbst.
Bei einem vom Sprachserver abgelehnten Auftrag werden stattdessen Auftrag-ID,
Stimme, Textanfang, Ablehnungsgrund und der gewählte Ersatzweg ausgegeben;
ein künstlicher BTS-Stacktrace würde hier nur die Meldestelle zeigen.
Identische Wiederholungen werden höchstens alle 30 Sekunden ausgegeben.
Ein ausdrücklich mit `starting` gemeldeter Modellstart (HTTP 503) ist ein
normaler Startzustand. Neue Generierungsanfragen warten bis zur erfolgreichen
Bereitschaftsprüfung; andere HTTP-503-Antworten werden als Fehler gemeldet.

Ein kleiner globaler Fehlerstatus wird über die vorhandenen Admin-WebSockets
an alle Adminfenster verteilt, unabhängig vom geöffneten Turnier. Neue und neu
verbundene Fenster melden die Unterstützung über `speech_health_subscribe` an
und erhalten dann den aktuellen Stand sofort. Ältere offene Adminfenster
bekommen diesen neuen Nachrichtentyp erst nach einem Neuladen; der Server
fordert keinen automatischen Reload an, der Eingaben verwerfen könnte.
Der feste Warnbereich
nennt den betroffenen Ansagenbereich und den Fehlercode, bleibt bei Navigation
sichtbar und verschwindet nach der erfolgreichen Wiederherstellung. Er zeigt
keine Audiodaten, API-Schlüssel oder Stacktraces. Normales Beenden des Workers
erzeugt keinen Alarm. Ausführliche Serverdiagnosen bleiben über die UI steuerbar.
Bei Verbindungsfehlern steht „Sprachserver nicht erreichbar“ zusammen mit der
konfigurierten Adresse und einer passenden Erklärung im Vordergrund; Fehlercodes
stehen unter **Technische Details**. Derselbe Hinweis erscheint auch auf der
Sprachhelferseite. Eine erfolgreiche Bereitschafts- und Stimmenabfrage räumt
auch frühere Verbindungsfehler einer Generierungsanfrage auf, ohne fachliche
Aufbereitungsfehler zu verbergen. Es sind keine zusätzlichen Statusabfragen nötig.

Zum Aktivieren **BTS neu starten und alle Browserseiten neu laden**. Die
Betreiberkonfiguration und der bestehende Sprachserver bleiben ansonsten gleich.
Vergleich/Rollback: `BTS_SPEECH_WORKER=0` bzw. `speech.worker: false` schaltet auf
die frühere Verarbeitung und Audioauslieferung im Hauptthread zurück.
`BTS_SPEECH_WORKER_TYPE=thread` bzw. `speech.worker_type: "thread"` wählt für
Vergleiche den bisherigen Worker-Thread; Standard ist `"process"`.

## Prüfung und Messung

Die regulären V2-Fragmente einschließlich Runden, Feldhinweisen in Vorbereitung
und Treffpunkt-Aufforderungen besitzen längere Kontextquellen. Auch der letzte
V2-Ersatzversuch für Namen verwendet einen vollständigen anderen Kontextsatz.
Die zusätzlich gesprochenen Quellwörter gehören nicht zum hörbaren Ausschnitt.
Eine [offline Tempo-Prüfung](../../docs/speech-tempo-preflight.md) vergleicht
fertige Clips vor dem Einsatz und bietet einen Hörvergleich ohne Änderungen
am Cache oder an der produktiven Wiedergabe.

Vor einer Spielansage synchronisiert ein Browserfenster fehlende Metadaten über
eine reine Statusabfrage. Die lokale Zusammensetzung wird erst zur Wiedergabe
mit der aktuellen Kontextversion erstellt, auch für bereits wartende Ansagen.
So fordert ein früh geöffnetes Fenster keine alten Einzeltexte an, während der
Server bereits fertige V2-Bausteine vorhält. Ein fehlgeschlagener Statusabruf
startet keine Generierung solcher Einzeltexte. Abbruch, Turnier- und
Stimmenwechsel während der Abfrage werden berücksichtigt. Browsermodus und
Server ohne Kontextunterstützung behalten ihre bisherigen Ausgabewege.
Der Trace `speech_resolve_result` nennt die Anzahl angefragter Teile,
Kontextteile und fertiger Clips sowie gegebenenfalls einen Fehlergrund;
Ansagetexte werden dabei nicht aufgezeichnet. Die Untersuchung und der
Start-Reproduktionstest stehen in
[Test 21](../../debug/performance_test21_2026-10-24.md).

Aufrufkandidaten werden im Sprachplan aus den aktuellen Turnierdaten berechnet,
auch ohne geöffnete Spielübersicht. Dazu gehören alle Spiele mit vollständigen
Spielern bis einschließlich der angezeigten Aufrufgrenze ihres Spielorts,
die noch nicht gestartet wurden und noch nicht in Vorbereitung sind.
Belegte Vorbereitungsplätze, Pausen
oder aktuell beschäftigte Spieler begrenzen diesen Sprachvorrat nicht weiter.
Die Grenzberechnung ist dieselbe wie in der Spieltabelle; der Worker erhält
dafür die Reihenfolge, die relevanten Regeln und die aktuelle Turnierzeit.
Diese Aufgaben bleiben in der Leerlaufpriorität hinter bereits ausgelösten
Aufrufen, laufenden Spielen und Spielen in Vorbereitung.

Die Worker-Tests prüfen Datenpakete ohne Datenbankexecutor, inkrementelle
Änderungen und Löschungen, WebSocket-Steuerung, geschützte direkte WAV-Abrufe,
Range/ETag, Aufbereitung, HTTPS, Worker-Neustart mit abgeschaltetem Sprachserver
und einen belegten Audioport. Browser-Modultests prüfen den direkten Anschluss
und eine konfigurierte Reverse-Proxy-Adresse.

Der isolierte Vergleich verwendet ausschließlich 519 synthetische Spiele mit
je 180 Verlaufseinträgen und acht vorbereiteten Spielen:

```sh
node debug/speech_worker_benchmark.js > /tmp/bts-speech-worker-benchmark.json
```

Er vergleicht dieselben Ergebnisse, sechs wechselnde Messpaare und die
Verspätung eines 2-ms-Timers im Hauptthread. Der gemeinsame 500-ms-Vorlauf ist
in der Gesamtdauer enthalten; der Worker-Erststart wird separat ausgewiesen.
Der eigene temporäre Audioport wird geöffnet, aber kein Audio abgerufen.
Es gibt keine Verbindung zu einem laufenden BTS oder Sprachserver, keine
Inferenz und keinen Zugriff auf echte Turnierdaten. Punktpersistenz, TV-Empfang,
Browser und Hallenwiedergabe müssen zusätzlich im Livebetrieb bewertet werden.

Der [Messlauf vom 19.10.2026](../../debug/performance_speech_worker_2026-10-19.json)
mit Node v19.9.0 verglich den damaligen Worker-Thread mit dem Hauptthread:

| Messgröße | Bisheriger Hauptthread | Worker |
| --- | ---: | ---: |
| Median der maximalen Timer-Verspätung je Lauf | 188,3 ms | 2,9 ms |
| Größte Timer-Verspätung aller sechs Läufe | 198,6 ms | 5,9 ms |
| Median der gesamten Planung einschließlich Vorlauf | 2.078,7 ms | 2.195,9 ms |

Der Worker-Erststart einschließlich erster Planung dauerte 1.836,1 ms; die
maximale Timer-Verspätung dabei betrug 5,4 ms. Die Vorbereitung wird hier etwas
langsamer fertig, während der Hauptthread deutlich besser reagiert. Der erste
Ansagesnapshot umfasst 168.370 JSON-Bytes gegenüber 4.542.723 Bytes vollständiger
Spielobjekte. Bei unverändertem Folgesnapshot wurden **0 Datensätze** übertragen.
Diese Werte isolieren die JavaScript-Planung und belegen keine Ende-zu-Ende-Latenz
echter Punkte oder Durchsagen unter laufender Sprachsynthese.

Der Sprachprozess trennt JavaScript-Rechenarbeit, Heap und Dateiarbeitspool vom BTS. Beide
konkurrieren weiterhin um CPU, Arbeitsspeicher und Datenträger; besonders die
Sprachsynthese im separaten Sprachserver kann den Rechner auslasten. Bei
verbleibenden Ausreißern ist als weiterer Vergleich ein kleineres CPU-Budget für
den Sprachserver sinnvoll (`BTS_TORCH_THREADS`, bei Kitten zusätzlich
`BTS_KITTEN_DECODER_THREADS`). Das verbessert möglicherweise die BTS-Reaktion
bei längerer Synthesezeit und muss am eingesetzten Rechner gemessen werden.

Die weitere Trennung des Dateiarbeitspools lässt sich ohne Server oder echte
Turnierdaten prüfen:

```sh
node debug/speech_io_isolation_benchmark.js
```

Der Vergleich verwendet sechs wechselnde Messpaare nach dem Aufwärmen und
einen absichtlich auf einen Thread begrenzten libuv-Pool. Er misst einen echten
NeDB-Dateiappend während synthetischer Cache-Persistenz und während eines
belegten Pools. Jeder Append wird durch erneutes Laden geprüft. Der zweite
Fall belegt die Trennung der Pools, aber keine Verursachung konkreter
Live-Ausreißer durch Sprache. Siehe
[Auswertung von Test 11](../../debug/performance_test11_2026-10-23.md).
