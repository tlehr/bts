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
4. Unter **Ansagen auf diesem Gerät** den Modus **Lokaler Sprachserver mit Browser-Fallback** und die lokale Stimme wählen.
5. Einmal **Audio aktivieren**, danach den vorhandenen Sprachtest verwenden.
6. Die bisherigen Hallen-Checkboxen für Spiel-/Vorbereitungsrufe wie gewohnt setzen. Für die deutschen Server-Stimmen muss die Turniersprache Deutsch sein; andere Sprachen bleiben im Automatikmodus bei Browser-TTS.

Der Sprachtest zeigt, ob tatsächlich Server-Audio oder Browser-Fallback verwendet wurde. Der Cache-Status zeigt für die ausgewählte Stimme vorbereitete und noch anstehende Teile. **Nur lokales Server-Audio** überspringt unbereite Ansagen, statt sie per Browser zu sprechen; für den Turnierbetrieb wird deshalb Automatik empfohlen. **Browser-TTS** ist der unmittelbare Rollback auf die bisherige Ausgabe.

Die CPU muss die Vorbereitungen zunächst abarbeiten. Bereits bekannte Texte werden automatisch frühzeitig erzeugt; bei einem ersten Kaltstart oder bisher unbekannten Namen kann trotzdem ein Fallback erforderlich sein. Generierung selbst löst keine Wiedergabe aus.

## Lokale Bereitschaft einzelner Durchsagen

Aufruf-Schaltflächen zeigen für die auf diesem Gerät ausgewählte lokale Stimme eine kleine Statusmarkierung. Dies umfasst Spielruf, Vorbereitungsruf je Halle, Zweitrufe für Spieler/Offizielle und Spielbeginn. Sprachtest und freie Ansagen zeigen denselben Cache-Status.

- Grün mit Haken: **Lokal bereit**, alle benötigten Sprachbausteine sind fertig, lokale Ausgabe ist ausgewählt und das Audioelement dieses Geräts ist freigegeben.
- Gelb mit Punkten: **Wird vorbereitet**, mindestens ein Baustein ist noch in der Warteschlange oder Generierung.
- Grau mit Minus: **Noch nicht bereit**, benötigte Bausteine fehlen im BTS-Adapter. Ein Fragezeichen bedeutet, dass die Prüfung noch aussteht.
- Rot mit Ausrufezeichen: Generierung/Audiodatei fehlgeschlagen oder Status/Sprachserver nicht verfügbar.

Der Tooltip nennt Stimme und Anzahl fertiger Bausteine; auch das zugängliche Label enthält diesen Text. Gleiche Teile werden innerhalb einer Durchsage nur einmal gezählt. Bei ausgewähltem Browser-TTS bleibt die Markierung grau. Ohne bestätigte Audiofreigabe erscheint **Audio aktivieren**; ein Audiofehler entfernt den grünen Haken. Die Hallen-Checkboxen müssen zusätzlich für die tatsächliche Wiedergabe aktiviert sein. Bei Remote-Ansagen gelten Stimme, Modus und Audiofreigabe des empfangenden Geräts.

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

## Was vorab gecacht wird

Beim BTS-Start werden vorhandene Turniere vorgemerkt; ein Browser muss dafür nicht geöffnet sein. Je Turnier werden Spiele in Vorbereitung, priorisierte Kandidaten aus der vorhandenen Vorbereitungsselektion und die nächsten geplanten Spiele bis zum konfigurierten Horizont vorbereitet. Bereits in Vorbereitung/auf dem Feld befindliche Spiele und echte Aufrufkandidaten bleiben zusätzlich enthalten, damit der Horizont einer Halle nicht die nötigen Ansagen einer anderen Halle verdrängt. Bereits vorbereitete/aufgerufene Spiele und reale Kandidaten erhalten höhere Priorität.

Die Vorbereitung umfasst unveränderte Bestandteile von Spielruf, Vorbereitungsruf, Spieler-/Offiziellen-Zweitruf und Spielbeginn. Feldtexte werden für aktive Felder bereits ohne feste zukünftige Feldzuweisung erzeugt. Bei noch offenem Standort werden die vorhandenen Hallen-/Meetingpoint-Varianten berücksichtigt. Bekannte Namen, Disziplinen, Runden und Matchnummern werden auch dann vorbereitet, wenn einzelne künftige Offizielle noch fehlen.

BTS-Datenänderungen, die vorhandene Kandidatenabfrage und zusätzlich eine periodische Prüfung erneuern die Vorbereitung. Freie Ansagen werden beim Tippen nach einer kurzen Ruhephase vorbereitet. Neu ausgewählte Stimmen bekommen eigene Vorbereitungen. Identische Teile verschiedener Spiele/Clients teilen sich den Sprachserver-Cache.

Noch unbekannte Gegner, zukünftige Änderungen und spontan eingegebene Ansagen können nicht vor ihrer Kenntnis vertont werden. Das aktuelle, tatsächlich ausgelöste Textarray ist deshalb immer maßgeblich: es wird beim Ruf exakt erneut aufgelöst. Die Aufnahme eines früheren Textes wird nicht aufgrund derselben Match-ID verwendet.

## Datenfluss und Wiedergabe

- static/js/announcement_text.js enthält die gemeinsam verwendeten bisherigen Textfunktionen. Browser und Backend erhalten denselben Text; weder U17 noch Namen oder Satzzeichen werden zusätzlich geändert.
- bts/speech/text.js rendert diese Funktionen nur zur Vorbereitung, ohne Wiedergabe.
- bts/speech/prefetch.js liest vorhandene Turnierdaten im Hintergrund und wartet auf freie Foreground-Arbeit.
- bts/speech/broker.js dedupliziert, priorisiert und pollt die versionierte API; bts/speech/http.js setzt einen vollständigen Request-Timeout.
- Die vorhandene /ws/admin-Verbindung bietet speech_prepare, speech_resolve und speech_status. Die Verbindung muss zuvor das betreffende Turnier erfolgreich geladen haben; Speech-Fehler beeinträchtigen den allgemeinen Verbindungsstatus nicht.
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

Am 14.10.2026 nach der Fallback-Korrektur: vollständige BTS-Suite 1017 bestanden; sieben optionale End-to-End-Fälle darin standardmäßig deaktiviert. Zusätzlich bestanden 60 gezielte Text-, Provider-, Backend- und Anzeigetests sowie alle sieben separat aktivierten End-to-End-Fälle mit tatsächlichem BTS, FastAPI/Mock-TTS und nativem Chrome: Vorab-Cache und geschützter WAV-Abruf, Nutzeraktivierung/Audioausgabe, Cache-Markierungen am Vorbereitungsaufruf und an einer freien Ansage ohne Wiedergabe, lokale Ausgabe trotz verzögerter Resolve-Abfrage, sichtbarer Fallback bei Audio-Abruffehler, echter Spielaufruf über den bestehenden WebSocket ohne doppelte Wiedergabe sowie Cache-Wiederverwendung nach frischem Adapterstart.

Die neuen Regressionsfälle prüfen insbesondere die direkte lokale Wiedergabe eines grün markierten Vorbereitungsaufrufs im Automatikmodus mit über fünf Minuten alten Backend-Einträgen und künstlich verzögerter Resolve-Abfrage sowie einen tatsächlich im nativen Browser blockierten Audio-Download mit sichtbarem Fallback-Grund und entfernter grüner Markierung. Der tatsächliche WAV-Aufruf bleibt geschützt; originale Ansagetexte und Mehrfachwiedergabeschutz sind weiterhin geprüft.

Der Sprachserver bestand 54 Mock-Tests einschließlich Synthesekonfigurations-Invalidierung. Seine echte Qwen-CPU-Anbindung wurde zuvor mit beiden Referenzstimmen erfolgreich geprüft. Die lokale Verbindung ist im privaten config.json eingerichtet; der Sprachserver verwendet den vorhandenen geprüften Modellcache offline. Prozesse/Dienste werden für die Aktivierung durch den Betreiber gestartet bzw. neu gestartet.
