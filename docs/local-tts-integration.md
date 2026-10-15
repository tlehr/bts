# Lokale Sprachausgabe im BTS

Auf **feat/localTts** ist der BTS-Sprachserver jetzt tatsächlich angebunden. Das Backend bereitet künftige Ansageteile vor, fragt fertige WAVs ab und liefert sie über signierte URLs aus. Die vorhandene Ansage-Queue, Standortauswahl, Tab-Leader und Browser-TTS bleiben erhalten.

## Lokal einrichten und aktivieren

Voraussetzung ist das separate, installierte bts-sprachserver-Projekt mit seinen beiden Referenz-WAVs, bestätigten Transkripten und .env.

    ./scripts/configure-local-tts.sh ../bts-sprachserver

Das Skript liest die Sprachserver-.env als Daten, übernimmt den API-Key in die private Datei data/speech-api-key und ergänzt ausschließlich die speech-Konfiguration in der bestehenden config.json. Andere BTS-Einstellungen bleiben erhalten. Die ursprüngliche Konfiguration wird einmalig unter data/speech-config-backup.json gesichert. Geheimnisse und diese Dateien sind gitignored. Das Skript veröffentlicht nichts und startet keine Dienste.

Anschließend:

1. Im Sprachserver-Projekt ./scripts/start.sh starten.
2. Den BTS-Prozess/Dienst mit dem bestehenden Startverfahren neu starten.
3. Die BTS-Seite neu laden.
4. Auf der vorhandenen **BTS-Einstellungsseite → Aufrufe** den Modus **Lokaler Sprachserver mit Browser-Fallback** und die lokale Stimme wählen. Beide gelten für alle Clients dieses Turniers.
5. Im jeweiligen Browser einmal **Audio aktivieren**, zur Turnieransicht zurückkehren und den vorhandenen Sprachtest verwenden.
6. Die bisherigen Hallen-Checkboxen für Spiel-/Vorbereitungsrufe wie gewohnt setzen. Für die deutschen Server-Stimmen muss die Turniersprache Deutsch sein; andere Sprachen bleiben im Automatikmodus bei Browser-TTS.

Der Sprachtest zeigt, ob tatsächlich Server-Audio oder Browser-Fallback verwendet wurde. Der Cache-Status zeigt für die ausgewählte Stimme vorbereitete und noch anstehende Teile. **Nur lokales Server-Audio** überspringt unbereite Ansagen, statt sie per Browser zu sprechen; für den Turnierbetrieb wird deshalb Automatik empfohlen. **Browser-TTS** ist der unmittelbare Rollback auf die bisherige Ausgabe.

Die Sprachsteuerung liegt im vorhandenen Bereich **Aufrufe** der BTS-Einstellungsseite. Modus und Stimme werden wie die Ansagegeschwindigkeit automatisch im Turnier gespeichert (`announcement_speech_mode`, `announcement_speech_voice`) und über die bestehende WebSocket-Verbindung an alle Clients verteilt. Sie bleiben nach Neuladen und BTS-Neustart erhalten. Frühere lokale Browser-Einstellungen werden ignoriert. Solange keine Auswahl gespeichert wurde, gelten die Vorgaben der Backend-Konfiguration. Die Audiofreigabe und das Stoppen der aktuellen Wiedergabe betreffen weiterhin das jeweilige Gerät; Browser erlauben keine zentrale Audiofreigabe. Die Hallenfreigaben, freie Ansagen, der Sprachtest und die Anzeige der tatsächlichen Ausgabe bleiben in der Turnieransicht erreichbar.

Daneben zeigt **Texte und Reihenfolge** die im BTS vorgemerkten Texte für die zentral gewählte Stimme des geladenen Turniers mit Priorität und Status. Der laufende Auftrag steht oben, danach folgen die sendbaren Texte in der tatsächlichen Reihenfolge: **Hoch** (aktueller Aufruf), **Normal** (bevorstehendes Spiel), **Niedrig** (Vorrat). Zurückgestellte oder fehlgeschlagene Texte und fertige Aufnahmen folgen darunter. Die Nummern beziehen sich auf die gemeinsame Warteschlange; Texte anderer Turniere werden nicht angezeigt. Ein bereits laufender anderer Auftrag wird allgemein als beschäftigt gemeldet. Das Lesen der Liste erzeugt keine neuen Aufträge.

Mit **🔊** lässt sich jede fertige lokale Aufnahme der gewählten Stimme einzeln probehören. Noch unfertige Texte haben einen deaktivierten Lautsprecher. Probehören verwendet ausschließlich die geschützte WAV, ohne Browser-Fallback, Prioritätsänderung oder neue Generierung. Es verändert die Stimmwahl nicht und unterbricht keine laufende Durchsage. Ein echter Aufruf darf das Probehören unterbrechen. Bei Stimmwechsel oder Verlassen der Einstellungsseite endet das Probehören; reguläre Ansagen bleiben erhalten.

Die Liste aktualisiert sich auf der geöffneten Einstellungsseite bei sichtbarem Tab alle drei Sekunden und über **Cache-Status aktualisieren**. Sie zeigt den aktuell vom BTS verwalteten Cache und Vorbereitungshorizont, kein vollständiges Archiv des Sprachservers. Beim Verlassen der Seite endet die Abfrage. Für diese Erweiterung BTS neu starten und die Seite neu laden; am Sprachserver ist keine Änderung nötig.

Die CPU muss die Vorbereitungen zunächst abarbeiten. Bereits bekannte Texte werden automatisch frühzeitig erzeugt; bei einem ersten Kaltstart oder bisher unbekannten Namen kann trotzdem ein Fallback erforderlich sein. Generierung selbst löst keine Wiedergabe aus.

## Lokale Bereitschaft einzelner Durchsagen

Aufruf-Schaltflächen zeigen für die auf diesem Gerät ausgewählte lokale Stimme eine kleine Statusmarkierung. Dies umfasst Spielruf, Vorbereitungsruf je Halle, Zweitrufe für Spieler/Offizielle und Spielbeginn. Sprachtest und freie Ansagen zeigen denselben Cache-Status.

- Grün mit Haken: **Lokal bereit**, alle benötigten Sprachbausteine sind fertig, lokale Ausgabe ist ausgewählt und das Audioelement dieses Geräts ist freigegeben.
- Gelb mit Punkten: **Wird vorbereitet**, mindestens ein Baustein ist noch in der Warteschlange oder Generierung.
- Grau mit Minus: **Noch nicht bereit**, benötigte Bausteine fehlen im BTS-Adapter. Ein Fragezeichen bedeutet, dass die Prüfung noch aussteht.
- Rot mit Ausrufezeichen: Generierung/Audiodatei fehlgeschlagen oder Status/Sprachserver nicht verfügbar.

Der Tooltip nennt Stimme und Anzahl fertiger Bausteine; auch das zugängliche Label enthält diesen Text. Gleiche Teile werden innerhalb einer Durchsage nur einmal gezählt. Bei ausgewähltem Browser-TTS bleibt die Markierung grau. Ohne bestätigte Audiofreigabe erscheint **Audio aktivieren**; ein Audiofehler entfernt den grünen Haken. Die Hallen-Checkboxen müssen zusätzlich für die tatsächliche Wiedergabe aktiviert sein. Stimme und Modus gelten auch für Remote-Ansagen zentral; Audiofreigabe und Hallenaktivierung bleiben gerätebezogen.

Die Prüfung verwendet ausschließlich `speech_status` mit unveränderten Texten, ohne Generierung, Prioritätsänderung oder Wiedergabe auszulösen. Pro Aktualisierung werden höchstens zwei Pakete mit jeweils 64 unterschiedlichen Bausteinen geprüft, bevorzugt für sichtbare Bedienelemente. Die automatische Prüfung läuft alle fünf Sekunden, pausiert bei verborgenem Tab und begrenzt zusätzliche Prüfungen durch Neurendern. Nach 15 Sekunden ohne Bestätigung verfällt eine grüne Beobachtung. Stimmen-/Sprach-/Turnierwechsel, Textänderungen und eine geänderte Synthesekonfiguration werden berücksichtigt. **Cache-Status aktualisieren** prüft zusätzlich auf Nutzerwunsch.

Die Statusabfrage fordert mit `audio_urls: true` auch die bereits geschützten Audio-URLs an. Der Browser übernimmt diese für höchstens 15 Sekunden und verwendet sie beim Aufruf der exakt gleichen Texte/Stimme/Sprache im selben Turnier direkt. Damit hängt eine grün markierte Durchsage nicht von einer weiteren Cache-Abfrage innerhalb der kurzen Wartezeit bis zur Wiedergabe ab. Die Berechtigungsprüfung des Audio-Proxys bleibt bestehen. Fehlt eine vollständige frische Bestätigung, greift die bisherige kurze Auflösung mit Automatik-Fallback.

Ältere abgeschlossene Backend-Einträge werden nach fünf Minuten im Hintergrund erneut gegen den persistenten Sprachserver-Cache geprüft. Ihr fertiges Audio bleibt während dieser Prüfung verfügbar; erst eine tatsächliche neue Antwort oder eine geänderte Synthesekonfiguration ändert den Status. Zuvor wurde ein älterer fertiger Eintrag beim Aufruf vorübergehend auf `unsubmitted` gesetzt, wodurch trotz Haken ein Fallback entstehen konnte.

Unter der Sprachausgabe steht die tatsächliche aktuelle/letzte Ausgabe einschließlich Fallback-Grund. Auch der Sprachtest nennt diesen Grund: etwa unvollständiger Cache, verspätete Antwort, gesperrte Audiowiedergabe oder nicht ladbare Audiodatei. Ein Browser-Autoplay-Verbot (`NotAllowedError`) wird von einem Download-/Decoderfehler unterschieden. Die Generierung und spätere Cache-Bestätigungen lösen weiterhin keine nachträgliche zweite Wiedergabe aus.

## Betreiberkonfiguration

Im Beispiel config.json.default ist der externe Dienst zunächst deaktiviert. Das Einrichtungsskript aktiviert ihn lokal. Manuelle Konfiguration:

    "speech": {
      "enabled": true,
      "url": "http://127.0.0.1:8077",
      "api_key_file": "data/speech-api-key",
      "mode": "auto",
      "voice": "hallensprecherin",
      "prefetch_matches": 12,
      "prefetch_interval_ms": 30000,
      "deadline_ms": 700
    }

Alternativ BTS_SPEECH_ENABLED=true, BTS_SPEECH_URL, BTS_SPEECH_API_KEY_FILE oder BTS_SPEECH_API_KEY im **Backend-Prozess** setzen. Keinen Sprachserver-Key ins Browser-JavaScript oder in ausgelieferte Turnierdaten schreiben.

Weitere optionale Grenzen: max_entries (512), max_text (1200), timeout_ms (2500), submit_interval_ms (650), poll_interval_ms (2000), audio_url_ttl_seconds (900), audio_timeout_ms (30000), max_audio_clients (16). Der lokale Adapter begrenzt neue POSTs, gibt bei 429 Raum frei und blockiert keinen Spielruf auf CPU-Inferenz.

BTS hält die gesamte Warteliste selbst und übermittelt **höchstens einen offenen Generierungsauftrag**. Erst nach dessen Abschluss oder endgültigem Fehler wird der nächste Text gewählt: tatsächliche Aufrufe (`high`), unmittelbar bevorstehende Ansagen (`normal`), danach übrige Vorbereitungen (`low`). Pro Turnier wird ausschließlich die zentral ausgewählte Stimme vorbereitet. Beim Stimmwechsel entfallen die lokalen Vormerkungen der abgewählten Stimme, sofern sie kein anderes Turnier benötigt. Bereits erzeugte Audiodateien bleiben im persistenten Sprachserver-Cache; ein schon übermittelter Auftrag wird noch abgeschlossen. Bei zentral ausgewähltem Browser-TTS werden keine weiteren lokalen Generierungen vorgemerkt. Veraltete Clients dürfen keine andere Stimme zur Generierung anmelden. Nutzen unterschiedliche Turniere unterschiedliche Stimmen, bleibt deren abwechselnde Bedienung bei gleicher Priorität erhalten. Ferne Vorabarbeit verdrängt keine noch ausstehende unmittelbar bevorstehende Ansage.

Ein unklarer Übermittlungsfehler hält denselben Auftrag fest; BTS versucht ihn identisch erneut, statt parallel andere Texte zu senden. Der Sprachserver fasst solche Wiederholungen zusammen. Er lehnt einen anderen neuen Auftrag während eines offenen Jobs mit `429/busy` und `Retry-After: 1` ab. Bereits fertige Cache-Treffer bleiben verfügbar. Nach einer Busy-Antwort bleiben die Texte im BTS; während der Wartezeit werden keine anderen Teile an der Ablehnung vorbei geschickt.

Für die Umstellung BTS und Sprachserver neu starten und die BTS-Seite neu laden. Beim Sprachserver-Neustart wird höchstens ein alter offener Auftrag fortgesetzt. Weitere alte Warteaufträge werden mit `queue_released` als fehlgeschlagen markiert; Texte, Metadaten, fertige Audios und Freigaben bleiben erhalten. BTS bereitet die aktuell noch benötigten Ansageteile aus den Turnierdaten erneut vor. Die Cache-Anzeige meldet ausdrücklich, wenn der Sprachserver beschäftigt ist und weitere Ansageteile im BTS warten.

## Optionale Qwen-Modellgröße

Der Sprachserver bietet zusätzlich Qwen3-TTS 0.6B Base als Startoption. Im separaten Projekt zunächst das gepinnte Modell herunterladen:

    BTS_OFFLINE=false ./scripts/start.sh --model-size 0.6b --download-model

Danach den bisherigen Sprachserver regulär stoppen und mit `./scripts/start.sh --model-size 0.6b` starten. `./scripts/start.sh --model-size 1.7b` wechselt wieder zur bisherigen Größe. Ohne Auswahl bleibt die bestehende Konfiguration maßgeblich. Pro Serverprozess wird ein Modell geladen; die Größe wird nicht je Browser ausgewählt.

API-Adresse, Schlüssel und öffentliche Stimmen-IDs bleiben gleich. Die eigenen Referenzaufnahmen können weiterverwendet werden; der Klang kann zwischen den Modellen abweichen. Der bestehende BTS-Adapter erkennt Modell-/Revisionsänderungen über `/health` und trennt die vorbereiteten Audios über die Syntheseidentität. Bestehende Aufnahmen werden nicht als passende Aufnahmen des anderen Modells ausgegeben. Nach dem Modellwechsel die Bereitschaft des Sprachservers abwarten und die Seite neu laden.

Die Messanleitung und Ergebnisse stehen im Sprachserver-Projekt unter `docs/model-comparison.md`. Der Wechsel auf das kleinere Modell ist eine Option; seine CPU-Geschwindigkeit muss am eingesetzten Rechner geprüft werden.

## Optionales Kitten-C++-Backend

Nach dem bestätigten Kitten-Hörtest ist die native Alternative im separaten Sprachserver angebunden. Dort einmalig installieren, den bisherigen Sprachserver regulär stoppen und neu starten:

    ./scripts/install-kitten.sh
    ./scripts/start.sh --backend kitten_cpp

Die Installation benötigt die beiden vorhandenen Referenz-WAVs samt ihren bestätigten Texten, einen C++20-Compiler und git. Sie bereitet je Stimme ein eigenes privates Profil vor. Sie ändert keine `.env` und keine bestehende Referenzkonfiguration. Der Worker hält Modell und Decoder geladen; die API nutzt weiterhin dauerhafte Jobs und WAVs.

`/health` muss `backend: kitten_cpp`, `model: KittenML/kitten-tts-2` und `status: ready` anzeigen. BTS-Adresse, Schlüssel und die Auswahl **Lokaler Sprachserver mit Browser-Fallback** bleiben gleich. BTS erkennt den Wechsel über Backend und Syntheseidentität, verwirft bisherige Bereitschaftszuordnungen und fordert die passenden Teile automatisch vorab an. Sobald diese fertig sind, erscheinen dieselben grünen Markierungen. Generierung löst keine Wiedergabe aus.

Qwen- und Kitten-Caches sind getrennt; vorhandene Freigaben bleiben erhalten. Verspätete API-Antworten eines vor dem Wechsel begonnenen Auftrags werden verworfen und können keine alte Aufnahme wieder als bereit markieren. Rückwechsel im Sprachserver: `./scripts/start.sh --backend qwen --model-size 1.7b`. Für einen dauerhaften Kitten-Start kann der Betreiber dort `BTS_BACKEND=kitten_cpp` konfigurieren. Die Auswahl erfolgt einmal je Sprachserverprozess.

Im echten API-Test brauchten die vollständigen Beispielansagen auf dem bisherigen i7 ungefähr 37 und 32 Sekunden. Der Vorab-Cache bleibt deshalb erforderlich. Die männliche Kitten-Referenz wurde technisch erfolgreich geklont und benötigt noch eine Hörabnahme. Installation, Offline-Build und systemd-Pfade: `bts-sprachserver/docs/kitten-backend.md`.

## Was vorab gecacht wird

Beim BTS-Start werden vorhandene Turniere vorgemerkt; ein Browser muss dafür nicht geöffnet sein. Je Turnier werden Spiele in Vorbereitung, priorisierte Kandidaten aus der vorhandenen Vorbereitungsselektion und die nächsten geplanten Spiele bis zum konfigurierten Horizont vorbereitet. Bereits in Vorbereitung/auf dem Feld befindliche Spiele und echte Aufrufkandidaten bleiben zusätzlich enthalten, damit der Horizont einer Halle nicht die nötigen Ansagen einer anderen Halle verdrängt. Bereits vorbereitete/aufgerufene Spiele und reale Kandidaten erhalten höhere Priorität.

Die Vorbereitung umfasst unveränderte Bestandteile von Spielruf, Vorbereitungsruf, Spieler-/Offiziellen-Zweitruf und Spielbeginn. Feldtexte werden für aktive Felder bereits ohne feste zukünftige Feldzuweisung erzeugt. Bei noch offenem Standort werden die vorhandenen Hallen-/Meetingpoint-Varianten berücksichtigt. Bekannte Namen, Disziplinen, Runden und Matchnummern werden auch dann vorbereitet, wenn einzelne künftige Offizielle noch fehlen.

Beim Spielbeginn und bei Offiziellen-Zweitrufen verbindet der gemeinsame BTS-Textbaustein die Feldansage mit dem folgenden Satz durch ein Leerzeichen: etwa `Auf Spielfeld 5! Bitte mit dem Spielen beginnen!`. Vorab-Cache und tatsächlicher Aufruf verwenden denselben Textbaustein, auch für noch unzugewiesene künftige Felder. Ohne Feldzuweisung entsteht kein führendes Leerzeichen. Die Korrektur erfolgt beim Zusammenstellen der BTS-Ansage; der Sprachserver erhält diesen Text unverändert. Der geänderte exakte Text hat einen eigenen Cache-Schlüssel und wird neu vorbereitet. Bereits vorhandene Aufnahmen müssen dafür nicht gelöscht werden. BTS neu starten und alle Client-Seiten neu laden, damit alte Zusammensetzungen nicht mehr angefordert werden. Die Länge der hörbaren Satzpause bleibt vom Sprachmodell abhängig.

BTS-Datenänderungen, die vorhandene Kandidatenabfrage und zusätzlich eine periodische Prüfung erneuern die Vorbereitung. Freie Ansagen werden beim Tippen nach einer kurzen Ruhephase vorbereitet. Ein zentraler Stimmwechsel startet die Vorbereitung der neuen Stimme und beendet die noch nicht gesendete Vorarbeit für die vorherige Stimme. Identische Teile verschiedener Spiele/Clients teilen sich den Sprachserver-Cache.

Noch unbekannte Gegner, zukünftige Änderungen und spontan eingegebene Ansagen können nicht vor ihrer Kenntnis vertont werden. Das aktuelle, tatsächlich ausgelöste Textarray ist deshalb immer maßgeblich: es wird beim Ruf exakt erneut aufgelöst. Die Aufnahme eines früheren Textes wird nicht aufgrund derselben Match-ID verwendet.

## Datenfluss und Wiedergabe

- static/js/announcement_text.js enthält die gemeinsam verwendeten bisherigen Textfunktionen. Browser und Backend erhalten denselben Text; weder U17 noch Namen oder Satzzeichen werden zusätzlich geändert.
- bts/speech/text.js rendert diese Funktionen nur zur Vorbereitung, ohne Wiedergabe.
- bts/speech/prefetch.js liest vorhandene Turnierdaten im Hintergrund und wartet auf freie Foreground-Arbeit.
- bts/speech/broker.js dedupliziert, priorisiert und pollt die versionierte API; bts/speech/http.js setzt einen vollständigen Request-Timeout.
- Die vorhandene /ws/admin-Verbindung bietet speech_prepare, speech_resolve, speech_status und die rein lesende speech_queue. Die Verbindung muss zuvor das betreffende Turnier erfolgreich geladen haben; Speech-Fehler beeinträchtigen den allgemeinen Verbindungsstatus nicht.
- bts/speech/proxy.js prüft zeitlich begrenzte, an Turnier und Audio-ID gebundene HMAC-Berechtigungen und reicht WAV/Range/ETag durch. Ohne gültige Signatur gibt es kein Audio.
- static/js/speech_service.js entscheidet einmal je Wiedergabe-ID zwischen vorbereiteter WAV und Browser-Fallback. Nur vollständig bereite Batches werden als Server-Audio begonnen.
- static/js/announcements.js behält Queue, Claims, Leader und Pausen. Eine hörbar begonnene Ausgabe wird bei Fehlern nicht als vollständiger Ruf wiederholt. **Ansage stoppen** beendet aktive Ausgabe und verwirft ausstehende Ansagen.

Spätere Qwen-Abschlüsse füllen nur den Cache. Sie erzeugen keine neuen Wiedergabeereignisse. Mehrere erlaubte Geräte können dieselbe WAV je einmal nutzen. Ein einmal durch Nutzeraktion aktiviertes HTMLAudioElement wird für weitere Serverausgaben wiederverwendet.

Der Sprachserver liefert im Gesundheitscheck eine opaque configuration_version. Modell-, Voice-, Referenz-, Sampling- und relevante Bibliotheksänderungen invalidieren damit die lokalen BTS-Zuordnungen bei der nächsten Metadatenprüfung (15 Sekunden). Bevorzugte Varianten werden zusätzlich durch periodische Cache-Abfragen erneut berücksichtigt.

## Sicherheit und Betrieb

Die Browser erhalten nur kurzlebige Audio-Berechtigungen, keinen Sprachserver-Key. Die Generationsteuerung verwendet die **bestehende** BTS-Admin-WebSocket-Vertrauensgrenze. Der bisherige BTS hat keine allgemeine neue Benutzeranmeldung erhalten. Für Zugriff außerhalb des vertrauten Turniernetzes müssen dessen Admin-Zugriff und TLS im vorhandenen Deployment geschützt werden.

Der Audio-Proxy akzeptiert nur feste IDs, keinen Zielhost oder Dateipfad aus Browserdaten. Aktive Proxy-Downloads sind begrenzt; Verbindungsabbruch und Timeout geben den Slot frei. Neue Sprachsteuerungsanfragen werden ohne Textinhalt geloggt. API-Ausfälle, Überlastung und Neustarts lassen Spielverwaltung und vorhandene Realtime-Events weiterlaufen.

Aktuell werden nur deutsche Server-Stimmen angeboten. Englisch/Niederländisch bleiben beim bestehenden Browser-Provider, bis passende Profile und Sprachzuordnungen ausdrücklich geprüft sind.

## Tests

    ./node_modules/.bin/mocha test/test_speech_text.js test/test_speech_browser.js test/test_speech_backend.js test/test_speech_readiness.js
    npm test

Ein ausdrücklich aktivierter End-to-End-Test nutzt eine temporäre In-Memory-BTS-Datenbank, die **echte** FastAPI mit einer kleinen Mock-Engine und einen separaten Headless-Chrome. Er verändert keine produktiven Turnierdaten und benötigt den installierten Sprachserver sowie Chrome:

    BTS_SPEECH_INTEGRATION=1 ./node_modules/.bin/mocha test/test_speech_end_to_end.js

Optional BTS_SPEECH_PYTHON und BTS_SPEECH_CHROME für andere Installationspfade setzen. Der Test prüft Vorabgenerierung, tatsächlichen geschützten WAV-Abruf und native HTMLAudio-Wiedergabe nach Nutzeraktion. Die vorhandenen Qwen-CPU-Hörproben stehen zusätzlich im separaten Sprachserver-Projekt bereit.

Bytegenaue Vergleiche aller bisherigen Ansagearten, geänderte Gegner, Queue-Grenzen, Authentifizierung/Signaturen, Cache-Misses, Ausfälle, Abbruch, Teilwiedergabe und Mehrfachclients sind automatisiert geprüft. Die akustische Hallenabnahme und die eingesetzten Mobil-/Kioskbrowser bleiben praktische Betreiberprüfungen.


## Prüfstand dieses Auftrags

Nach Korrektur der Satzabstände: 82 gezielte Sprachtests und alle neun optionalen End-to-End-Fälle bestanden. Die Tests vergleichen Cache und tatsächlichen Aufruf für Spielbeginn und Offiziellen-Zweitrufe, einschließlich noch nicht zugewiesener Felder und Aufrufe ohne Feld. Die echte FastAPI erhält den korrekt getrennten Text; dessen geschützte WAV ist abrufbar. Alle anderen Textbestandteile bleiben im Vergleich mit der eingefrorenen Ausgangsversion bytegleich. Die akustische Satzpause wird durch diesen Test mit Mock-Synthese nicht bewertet.

Nach der zentralen Stimmwahl auf der bestehenden Einstellungsseite: 1036 BTS-Tests und 79 gezielte Sprachtests bestanden. Alle neun optionalen End-to-End-Fälle bestanden separat mit echter FastAPI und nativem Chrome. Zwei Browser übernehmen Stimm- und Modusänderungen ohne Neuladen; die Auswahl bleibt nach einem Neuladen erhalten und alte lokale Browser-Vorgaben werden ignoriert. Nach dem Wechsel werden ausschließlich Aufträge der gewählten Stimme erzeugt. Geprüft sind außerdem beide bestehenden Speicherwege einschließlich ungültiger Werte, das Entfernen überholter Vorarbeit bei weiterhin genau einem offenen Serverjob, keine lokale Generierung im Browser-Modus sowie die Textliste und Hörproben auf der bestehenden Einstellungsseite. Beim Verlassen der Seite stoppt die Hörprobe sofort und die Listenabfrage endet.

Nach Ergänzung der Textliste mit Probehören: 1033 BTS-Tests und 76 gezielte Sprachtests bestanden. Die neun optionalen End-to-End-Fälle bestanden separat mit echter FastAPI und nativem Chrome. Der neue Browserfall vergleicht die angezeigte Liste mit der tatsächlichen BTS-Reihenfolge, prüft gesperrte Lautsprecher für unfertige Texte, spielt die geschützten WAVs beider Stimmen ab und bestätigt unveränderte Stimmwahl, Auftragsliste und Generierungsanzahl. Fremde Turniertexte bleiben ausgeblendet; nach dem Schließen enden die Listenabfragen. Zusätzlich geprüft sind Abbruch, Vorrang echter Durchsagen sowie die Ablehnung veralteter oder turnierfremder Hörproben.

Nach der Umstellung auf einen offenen Generierungsauftrag: 1025 BTS-Tests bestanden, acht optionale End-to-End-Fälle regulär deaktiviert. Separat bestanden diese acht Fälle mit echter FastAPI und nativem Chrome, einschließlich Stimmwechsel zur männlichen Stimme, deren Vorab-Cache und anschließender lokaler Wiedergabe. Während der Browserfälle wurde geprüft, dass vor Abschluss des aktuellen Jobs kein weiterer Generierungsauftrag gesendet wird. 68 gezielte Sprachtests und 81 Sprachserver-Tests bestanden. Parallele unterschiedliche Serveranfragen, Busy-Ablehnung ohne Jobanlage, Cache-Abruf während laufender Generierung, verlorene POST-Antworten und der Umstieg aus der alten Server-Warteschlange sind geprüft.

Am 15.10.2026 nach der Kitten-Anbindung: 1019 BTS-Tests und 62 gezielte Sprachtests bestanden; sieben optionale End-to-End-Fälle bleiben in der normalen Suite deaktiviert. Separat wurden diese sieben Fälle mit echter FastAPI/Mock-Synthese und nativem Chrome erfolgreich ausgeführt. Die neuen Backend-Tests prüfen erneute Vorbereitung nach dem Wechsel und das Verwerfen verspäteter Antworten des vorherigen Backends. Der Sprachserver bestand 79 reguläre Tests sowie separat zweimal den echten Kitten-CPU-Test mit beiden Stimmen, Worker-Wiederverwendung, geschütztem WAV-Abruf und persistenten Cache-Treffern nach Neustart.

Am 14.10.2026 nach der Fallback-Korrektur: vollständige BTS-Suite 1017 bestanden; sieben optionale End-to-End-Fälle darin standardmäßig deaktiviert. Zusätzlich bestanden 60 gezielte Text-, Provider-, Backend- und Anzeigetests sowie alle sieben separat aktivierten End-to-End-Fälle mit tatsächlichem BTS, FastAPI/Mock-TTS und nativem Chrome: Vorab-Cache und geschützter WAV-Abruf, Nutzeraktivierung/Audioausgabe, Cache-Markierungen am Vorbereitungsaufruf und an einer freien Ansage ohne Wiedergabe, lokale Ausgabe trotz verzögerter Resolve-Abfrage, sichtbarer Fallback bei Audio-Abruffehler, echter Spielaufruf über den bestehenden WebSocket ohne doppelte Wiedergabe sowie Cache-Wiederverwendung nach frischem Adapterstart.

Die neuen Regressionsfälle prüfen insbesondere die direkte lokale Wiedergabe eines grün markierten Vorbereitungsaufrufs im Automatikmodus mit über fünf Minuten alten Backend-Einträgen und künstlich verzögerter Resolve-Abfrage sowie einen tatsächlich im nativen Browser blockierten Audio-Download mit sichtbarem Fallback-Grund und entfernter grüner Markierung. Der tatsächliche WAV-Aufruf bleibt geschützt; originale Ansagetexte und Mehrfachwiedergabeschutz sind weiterhin geprüft.

Der Sprachserver bestand 54 Mock-Tests einschließlich Synthesekonfigurations-Invalidierung. Seine echte Qwen-CPU-Anbindung wurde zuvor mit beiden Referenzstimmen erfolgreich geprüft. Die lokale Verbindung ist im privaten config.json eingerichtet; der Sprachserver verwendet den vorhandenen geprüften Modellcache offline. Prozesse/Dienste werden für die Aktivierung durch den Betreiber gestartet bzw. neu gestartet.
