# Lokale Sprachausgabe im BTS

Wortlaut, Reihenfolge und Stückelung der Turnierdurchsagen bearbeiten wir im [Arbeitsdokument zu den Durchsagen](durchsagen-arbeitsdokument.md).

## Kontext v2 und gemeinsame Wiedergabeaufbereitung

Der aktualisierte BTS nutzt das vom Sprachserver angebotene Profil
`bts-playback-v1` für alle tatsächlich abgespielten lokalen Ansagearten und beide
Stimmen. Es kürzt fast vollständige innere Satzpausen über 100 ms auf etwa 80 ms
und gleicht jeden Baustein nach EBU R128 ab (Hallensprecher −23 LUFS,
Hallensprecherin −22 LUFS, höchstens −1,5 dBTP). Erkannte Satzpausen bleiben erhalten.
Text, Synthesestrategie, Stimmenreferenzen und Tempo ändern sich dadurch nicht.

Die aufbereiteten Aufnahmen werden dauerhaft gespeichert und bei weiteren
Aufrufen sowie nach Neustarts direkt wiederverwendet. Eine erneute Bearbeitung
ist nur beim ersten Bedarf oder bei einer neuen Verarbeitungsversion nötig.
Bereits vorhandenes Originalaudio wird dafür ohne neue Synthese verwendet.
Vollständige Kontextquellen zum späteren Ausschneiden bleiben zusätzlich erhalten.

BTS verhandelt Profil und Verarbeitungsversion über `/health`, fordert sie bei
POST und Polling an und prüft die Bestätigung in der fertigen Antwort. Die
Verarbeitungsversion gehört zur BTS-Cacheidentität. Alte unbearbeitete Dateien
werden erhalten, aber nicht als bereits aufbereitete Wiedergabe ausgegeben.
Vorherige männliche Proxy-Pausenkürzung entfällt für diese Kopien.

Bei gemeinsamem Speicher liegt die Wiedergabekopie unter
`shared_audio_dir/playback/{audio_id}.wav`; BTS verwendet weiterhin Hardlinks und
seinen dauerhaften Offline-Cache. Ein Neustart erfordert weder erneuten
Audioabruf noch erneute Aufbereitung gespeicherter Dateien. Ältere Sprachserver
ohne Profilangebot behalten ihre bisherige Anbindung. Browser-TTS ist unverändert.
Die geprüfte v2-Implementierung ist auf `feat/localTts` übernommen. Bausteine,
Prioritäten und Betrieb sind in [Kontext v2 im BTS](context-v2-production.md)
beschrieben; die gesicherte v1 bleibt als Rückkehrmöglichkeit erhalten.

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
5. Zur Turnieransicht zurückkehren und den vorhandenen Sprachtest verwenden. BTS bereitet lokales Audio automatisch vor. Sperrt der Browser die Wiedergabe zunächst, gibt ein normaler Klick oder Tastendruck im BTS das Audio frei; ein gesonderter Aktivierungsknopf ist nicht mehr nötig.
6. Die bisherigen Hallen-Checkboxen für Spiel-/Vorbereitungsrufe wie gewohnt setzen. Für die deutschen Server-Stimmen muss die Turniersprache Deutsch sein; andere Sprachen bleiben im Automatikmodus bei Browser-TTS.

Der Sprachtest zeigt, ob tatsächlich Server-Audio oder Browser-Fallback verwendet wurde. Der Cache-Status zeigt für die ausgewählte Stimme vorbereitete und noch anstehende Teile. Fertige WAVs und ihre Zuordnungen bleiben jetzt auch im BTS dauerhaft erhalten; bei gemeinsamem Dateisystem lassen sich die WAV-Daten per Hardlink ohne doppelte Audiodaten nutzen. Diese lokale Ausgabe funktioniert nach einem Neustart auch ohne laufenden Sprachserver. Einrichtung und Grenzen beschreibt [Dauerhafter BTS-Cache und gemeinsamer Audiospeicher](context-tts.md#dauerhafter-bts-cache-und-gemeinsamer-audiospeicher). **Nur lokales Server-Audio** überspringt unbereite Ansagen, statt sie per Browser zu sprechen; für den Turnierbetrieb wird deshalb Automatik empfohlen. **Browser-TTS** ist der unmittelbare Rollback auf die bisherige Ausgabe.

Die Sprachsteuerung liegt im vorhandenen Bereich **Aufrufe** der BTS-Einstellungsseite. Modus und Stimme werden wie die Ansagegeschwindigkeit automatisch im Turnier gespeichert (`announcement_speech_mode`, `announcement_speech_voice`) und über die bestehende WebSocket-Verbindung an alle Clients verteilt. Sie bleiben nach Neuladen und BTS-Neustart erhalten. Frühere lokale Browser-Einstellungen werden ignoriert. Solange keine Auswahl gespeichert wurde, gelten die Vorgaben der Backend-Konfiguration. Die Audiofreigabe und das Stoppen der aktuellen Wiedergabe betreffen weiterhin das jeweilige Gerät; Browser erlauben keine zentrale Audiofreigabe. Die Hallenfreigaben, freie Ansagen, der Sprachtest und die Anzeige der tatsächlichen Ausgabe bleiben in der Turnieransicht erreichbar.

Daneben zeigt **Texte und Reihenfolge** die im BTS vorgemerkten Texte für die zentral gewählte Stimme des geladenen Turniers mit Priorität und Status. Der laufende Auftrag steht oben, danach folgen die sendbaren Texte in der tatsächlichen Reihenfolge: **Hoch** (aktuell ausgelöster Aufruf), **Normal** (benötigte Ansagen laufender/vorbereiteter Spiele und gemeinsame Bausteine), **Niedrig** (ausdrücklich angeforderter Text), anschließend **Nur bei Leerlauf** (weitere mögliche Ansagen). Zurückgestellte oder fehlgeschlagene Texte und fertige Aufnahmen folgen darunter. Die Nummern beziehen sich auf die gemeinsame Warteschlange; Texte anderer Turniere werden nicht angezeigt. Ein bereits laufender anderer Auftrag wird allgemein als beschäftigt gemeldet. Das Lesen der Liste erzeugt keine neuen Aufträge.

Mit **🔊** lässt sich jede fertige lokale Aufnahme der gewählten Stimme einzeln probehören. Noch unfertige Texte haben einen deaktivierten Lautsprecher. Probehören verwendet ausschließlich die geschützte WAV, ohne Browser-Fallback, Prioritätsänderung oder neue Generierung. Es verändert die Stimmwahl nicht und unterbricht keine laufende Durchsage. Ein echter Aufruf darf das Probehören unterbrechen. Bei Stimmwechsel oder Verlassen der Einstellungsseite endet das Probehören; reguläre Ansagen bleiben erhalten.

BTS meldet fertige oder fehlgeschlagene Teilstücke über die bestehende Admin-Verbindung. Auf der geöffneten Einstellungsseite werden daraufhin Cache-Status, Textliste und Fortschrittsbalken gemeinsam aktualisiert. Die Meldung enthält nur den Turnierbezug; die Anzeige liest den aktuellen Status, ohne neue Generierung oder Wiedergabe auszulösen. Schnelle aufeinanderfolgende Abschlüsse werden gebündelt, laufende Statusabfragen überlappen nicht. Zusätzlich bleibt bei sichtbarem Tab die Prüfung alle drei Sekunden und über **Cache-Status aktualisieren** erhalten. Nach Rückkehr zu einem verborgenen Tab wird erneut geprüft. Beim Verlassen der Einstellungsseite enden die Abfragen und Ereignis-Abonnements. Für diese Erweiterung BTS neu starten und die Seite neu laden; am Sprachserver ist keine Änderung nötig.

Der Fortschrittsbalken zeigt **fertige Aufnahmen / aktuell vorgemerkte Texte** für die gewählte Stimme dieses Turniers, ergänzt um Anzahl und Prozentwert. Die Zahl links stammt aus derselben Abfrage wie die Liste und der Balken. Fehlgeschlagene Texte werden separat genannt und zählen weiterhin zum noch offenen Vorrat. 100 % erscheinen erst, wenn alle enthaltenen Texte fertig sind. Ohne vorgemerkte Texte oder bei fehlendem Status bleibt der Balken ausgeblendet. Die Anzeige bezieht sich auf den aktuell vom BTS verwalteten Cache und Vorbereitungshorizont, kein vollständiges Archiv des Sprachservers.

Die CPU muss die Vorbereitungen zunächst abarbeiten. Bereits bekannte Texte werden automatisch frühzeitig erzeugt; bei einem ersten Kaltstart oder bisher unbekannten Namen kann trotzdem ein Fallback erforderlich sein. Generierung selbst löst keine Wiedergabe aus.

## Lokale Bereitschaft einzelner Durchsagen

Aufruf-Schaltflächen zeigen für die auf diesem Gerät ausgewählte lokale Stimme eine kleine Statusmarkierung. Dies umfasst Spielruf, Vorbereitungsruf je Halle, Zweitrufe für Spieler/Offizielle und Spielbeginn. Sprachtest und freie Ansagen zeigen denselben Cache-Status.

- Grün mit Haken: **Lokal bereit**, alle benötigten Sprachbausteine sind fertig, lokale Ausgabe ist ausgewählt und das Audioelement dieses Geräts ist freigegeben.
- Gelb mit Punkten: **Wird vorbereitet**, mindestens ein Baustein ist noch in der Warteschlange oder Generierung.
- Grau mit Minus: **Noch nicht bereit**, benötigte Bausteine fehlen im BTS-Adapter. Ein Fragezeichen bedeutet, dass die Prüfung noch aussteht.
- Rot mit Ausrufezeichen: Generierung/Audiodatei fehlgeschlagen oder Status/Sprachserver nicht verfügbar.

Der Tooltip nennt Stimme und Anzahl fertiger Bausteine; auch das zugängliche Label enthält diesen Text. Gleiche Teile werden innerhalb einer Durchsage nur einmal gezählt. Bei ausgewähltem Browser-TTS bleibt die Markierung grau. Während BTS die Audiofreigabe automatisch prüft, bleibt der Zustand „Wird geprüft“. Erst eine tatsächlich abgelehnte Wiedergabe zeigt **Browser wartet auf Klick**. Ein normaler Klick, Tastendruck oder Touch im BTS wiederholt die Freigabe automatisch; ein Audiofehler entfernt den grünen Haken. Die Hallen-Checkboxen müssen zusätzlich für die tatsächliche Wiedergabe aktiviert sein. Stimme und Modus gelten auch für Remote-Ansagen zentral; Audiofreigabe und Hallenaktivierung bleiben gerätebezogen.

Die Prüfung verwendet ausschließlich `speech_status` mit unveränderten Texten, ohne Generierung, Prioritätsänderung oder Wiedergabe auszulösen. Pro Aktualisierung werden höchstens zwei Pakete mit jeweils 64 unterschiedlichen Bausteinen geprüft, bevorzugt für sichtbare Bedienelemente. Fertigstellungsereignisse aktualisieren die Buttons direkt; schnelle Ereignisse werden gebündelt. Eine Änderung während einer laufenden Abfrage löst anschließend eine weitere Prüfung aus und geht nicht verloren. Beim Scrollen werden neu sichtbare, noch unbekannte Bausteine geprüft, während aktuelle Beobachtungen vier Sekunden weiterverwendet werden. Zusätzlich läuft alle fünf Sekunden eine Prüfung im sichtbaren Tab. Nach 15 Sekunden ohne Bestätigung verfällt eine grüne Beobachtung. Stimmen-/Sprach-/Turnierwechsel, Textänderungen und eine geänderte Kontextstrategie werden berücksichtigt. **Cache-Status aktualisieren** prüft zusätzlich auf Nutzerwunsch.

Die automatische Audiofreigabe prüft eine lautlose PCM-Aufnahme bei normaler Lautstärkeeinstellung. Ein stumm geschaltetes Audioelement könnte auch ohne Erlaubnis für hörbare Durchsagen starten und wäre keine zuverlässige Bestätigung. Gleichzeitig eintreffende Freigaben teilen sich einen Versuch; ein echter Aufruf wartet dessen Abschluss ab. Laufende Durchsagen werden durch die Freigabe nicht unterbrochen. Browser dürfen eine Benutzerinteraktion verlangen; siehe [Chrome-Autoplay-Regeln](https://developer.chrome.com/blog/autoplay/).

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
      "prefetch_interval_ms": 30000,
      "deadline_ms": 700
    }

Alternativ BTS_SPEECH_ENABLED=true, BTS_SPEECH_URL, BTS_SPEECH_API_KEY_FILE oder BTS_SPEECH_API_KEY im **Backend-Prozess** setzen. Keinen Sprachserver-Key ins Browser-JavaScript oder in ausgelieferte Turnierdaten schreiben.

Weitere optionale Grenzen: max_entries (512), max_text (1200), timeout_ms (2500), submit_interval_ms (650), poll_interval_ms (2000), audio_url_ttl_seconds (900), audio_timeout_ms (30000), max_audio_clients (16). Der lokale Adapter begrenzt neue POSTs, gibt bei 429 Raum frei und blockiert keinen Spielruf auf CPU-Inferenz.

BTS hält die gesamte Warteliste selbst und übermittelt **höchstens einen offenen Generierungsauftrag**. Erst nach dessen Abschluss oder endgültigem Fehler wird der nächste Text gewählt: tatsächlich ausgelöste Aufrufe (`high`), benötigte Ansagen laufender/vorbereiteter Spiele und gemeinsame Bausteine (`normal`), ausdrücklich angeforderte weitere Texte (`low`), anschließend mögliche spätere Ansagen ausschließlich im Leerlauf (`idle`, gegenüber dem Sprachserver als `low`). Pro Turnier wird vorrangig die zentral ausgewählte Stimme vorbereitet. Die Checkbox „Andere Stimme nur bei vollständigem Leerlauf auf Vorrat vorbereiten“ ist zunächst ausgeschaltet und wird zentral mit dem Turnier gespeichert. Eingeschaltet folgt die andere Stimme erst nach dem vollständigen Bedarf und Leerlaufvorrat der gewählten Stimme; neue Arbeit für die gewählte Stimme geht wieder vor. Auch ausstehende Wiederholungen und Planprüfungen gelten nicht als vollständiger Leerlauf. Fertige Zweitstimmen-Aufnahmen bleiben nach dem Ausschalten und bei aktiviertem BTS-Disk-Cache auch nach einem Neustart erhalten. Die zusätzliche interne Stufe `spare` wird in der Liste als „Andere Stimme · letzter Vorrat“ angezeigt und gegenüber dem Sprachserver als `low` gesendet. Quellen und Ausschnitte teilen diese Stufe. Die Balken bleiben auf die gewählte Stimme bezogen. Beim Stimmwechsel entfallen die lokalen Vormerkungen der abgewählten Stimme, sofern sie kein anderes Turnier benötigt. Bereits erzeugte Audiodateien bleiben im persistenten Sprachserver-Cache; ein schon übermittelter Auftrag wird noch abgeschlossen. Bei zentral ausgewähltem Browser-TTS werden keine weiteren lokalen Generierungen vorgemerkt. Veraltete Clients dürfen keine andere Stimme zur Generierung anmelden. Nutzen unterschiedliche Turniere unterschiedliche Stimmen, bleibt deren abwechselnde Bedienung bei gleicher Priorität erhalten. Ferne Vorabarbeit verdrängt keine noch ausstehende benötigte Ansage.

Der frühere Vorlaufparameter `prefetch_matches` wird weiterhin als Konfiguration akzeptiert, erweitert den regulären Bedarf aber nicht mehr um zukünftige Spiele. Solche Spiele werden unabhängig von einem festen Vorlauf nur im Leerlauf vorbereitet.

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

Die Vorbereitung umfasst Bestandteile von Spielruf, Vorbereitungsruf, Spieler-/Offiziellen-Zweitruf, Spielbeginn und kampfloser Entscheidung für beide möglichen Gewinner. Der Wortlaut bleibt erhalten. Feldtexte werden für aktive Felder bereits ohne feste zukünftige Feldzuweisung erzeugt. Bei noch offenem Standort werden die vorhandenen Hallen-/Meetingpoint-Varianten für Spieler und Offizielle berücksichtigt. Bekannte Namen, Disziplinen, Runden und Matchnummern werden auch dann vorbereitet, wenn einzelne künftige Offizielle noch fehlen.

Lokales Audio und Browser-TTS verwenden unterschiedliche Stückelungen aus denselben Textfunktionen. Die Funktionen merken sich beim Zusammensetzen die Bestandteile; Namen werden nicht nachträglich durch Textsuche zerlegt. Die bisherigen Browser-Textarrays einschließlich ihrer Satzabstände bleiben bytegleich. Für lokale Aufnahmen werden die wiederverwendbaren Bestandteile daraus abgeleitet:

| Aufrufbestandteil | Lokale Aufnahmen |
| --- | --- |
| Spielbeginn | `Auf Spielfeld 8` und `Bitte mit dem Spielen beginnen`; der zweite Satz nur einmal je Stimme/Sprache |
| Spieler und Doppel | Vollständige Personennamen, `und`, `gegen`; wechselnde Gegner/Partner brauchen keine neue Gesamtaufnahme |
| Offizielle und Zweitrufe | Aufrufpräfix, Rolle, Name und gegebenenfalls Feldansage getrennt |
| Vorbereitung | `In Vorbereitung`, Hallenergänzung, Namen und vollständige Meetingpoint-Hinweise; Einzahl/Mehrzahl bleiben erhalten |
| Kampfloser Sieg | Einleitungsangaben, Teams/Namen und feste Gewinnformulierung; beide möglichen Gewinner vorbereitet |
| Nummern, Disziplinen, Runden | Kurze Angaben wie `Spiel Nummer 17`, `Jungeneinzel U17` und `Halbfinale` bleiben zusammen |

Nur Leerraum an neuen Aufnahmegrenzen entfällt. Innerhalb der Bausteine bleiben Namen, bisherige Aussprache-Normalisierungen, Zahlen und Schreibweisen erhalten. Bei strukturierten Ansagen werden Satzzeichen an beiden Rändern eines Bausteins einheitlich als Wiedergabegrenzen geführt, unabhängig davon, ob sie separat angehängt wurden oder schon im vollständigen Baustein standen. Betroffen sind Komma, Semikolon, Doppelpunkt, Punkt, Ausrufezeichen und Fragezeichen. Nach Satzschluss werden 250 ms Pause eingefügt, nach Komma/Semikolon/Doppelpunkt 120 ms. Der lokale Cache verwendet damit beispielsweise immer `Spiel Nummer 186`; der normale Spielruf behält seine Satzpause, die Einleitung zur kampflosen Entscheidung ihre Kommapause. Auch Feldansagen, Rollen, Aufrufpräfixe, Runden, feste Hinweise und Hallenvarianten durchlaufen diese Behandlung.

Die Namensfunktionen kennzeichnen originale Namen, damit deren Satzzeichen einschließlich Initialen wie `Nina K.` erhalten bleiben. Satzzeichen innerhalb von Bausteinen bleiben ebenfalls erhalten. Browser-Textarrays bleiben unverändert; der lokale Wiedergabeplan enthält die ursprünglichen Satzzeichen und verwendet sie für die Pausen, ohne zusätzliche Satzzeichen-Varianten zu generieren.

Freie Ansagen und der Sprachtest behalten ihre vollständigen Texte. Die lokale Wiedergabe spielt die fertigen Bausteine der Reihe nach und berücksichtigt ihre zugehörigen Pausen. Stoppen wirkt auch während einer Pause und verhindert weitere Bausteine sowie einen anschließenden Browser-Fallback. Pausen werden bei einer Übergabe an einen anderen Tab mitgeführt. Natürliche Betonung und Übergänge hängen weiterhin vom Sprachmodell und den Aufnahmen ab; die Mock-Tests bewerten keine Sprachqualität. Für die vereinheitlichten Bausteine BTS neu starten und alle Clients neu laden. Bereits fertige Aufnahmen mit passendem Text können wiederverwendet werden; alte Satzzeichen-Varianten bleiben ungenutzt im Sprachserver-Cache. Noch fehlende Bausteine werden nach den bestehenden Prioritäten vorbereitet.

Vorab-Cache, Bereitschaftsmarkierung und tatsächlicher lokaler Aufruf verwenden denselben Plan. Beim Browser-Fallback erhält die gesamte Durchsage ihre ursprünglichen Browser-Textabschnitte, auch wenn nur ein lokaler Baustein fehlt. Eine bereits begonnene lokale Durchsage wird weiterhin nicht komplett per Browser wiederholt. Claims, Tab-Wechsel und Wiederholungsversuche führen beide Stückelungen mit.

Für diese Umstellung **BTS neu starten und alle Client-Seiten neu laden**. Damit verschwinden alte zusammengesetzte Vormerkungen aus dem BTS und die neuen Bausteine werden vorbereitet. Vorhandene WAVs bleiben im Sprachserver-Cache; passende unveränderte Bausteine werden wiederverwendet. Am Sprachserver ist keine Änderung nötig.

BTS-Datenänderungen, die vorhandene Kandidatenabfrage und zusätzlich eine periodische Prüfung erneuern die Vorbereitung. Freie Ansagen werden beim Tippen nach einer kurzen Ruhephase vorbereitet. Ein zentraler Stimmwechsel startet die Vorbereitung der neuen Stimme und beendet die noch nicht gesendete Vorarbeit für die vorherige Stimme. Identische Teile verschiedener Spiele/Clients teilen sich den Sprachserver-Cache.

Noch unbekannte Gegner, zukünftige Änderungen und spontan eingegebene Ansagen können nicht vor ihrer Kenntnis vertont werden. Das aktuelle, tatsächlich ausgelöste Textarray ist deshalb immer maßgeblich: es wird beim Ruf exakt erneut aufgelöst. Die Aufnahme eines früheren Textes wird nicht aufgrund derselben Match-ID verwendet.

## Zahlen vor dem Sprachserver ausschreiben

Auf Wunsch werden alle Ziffern im deutschen Sprachserver-Text ausgeschrieben. Dies ist eine ausdrückliche Ausnahme zur bisherigen unveränderten Textübergabe: Erst `bts/speech/broker.js` erstellt direkt vor `POST /v1/speech` die Sprechfassung mit `bts/speech/numbers.js`. Anzeige, gespeicherte Turnierdaten, Textliste, Browser-TTS und die Originaltexte der lokalen Bausteine behalten ihre Ziffern. Für beide lokalen Stimmen gelten dieselben Regeln, auch bei freien Ansagen und Sprachtests.

Beispiele: `Auf Spielfeld 8` → `Auf Spielfeld acht`, `Spiel Nummer 186` → `Spiel Nummer einhundertsechsundachtzig`, `U17` → `U siebzehn`. Ganze Zahlen werden zusammenhängend gesprochen, damit innerhalb einer Zahl keine zusätzlichen Wortpausen entstehen. Deutsche Tausenderpunkte werden aufgelöst (`1.234`), Dezimalkommas als „Komma“ gesprochen und Nachkommastellen einzeln gelesen (`1,05` → `eins Komma null fünf`). Führende Nullen und Zahlen oberhalb der unterstützten Größenordnung werden ziffernweise ausgeschrieben, ohne Rundung. Andere Zahlennotationen behalten ihre Trennzeichen; Datum, Uhrzeit, Ergebnis und Ordnungszahl werden nicht anhand des Kontextes umformuliert. Der übrige Wortlaut bleibt erhalten; zwischen Buchstaben und ausgeschriebenen Zahlen werden bei Bedarf Leerzeichen eingefügt.

Vorbereitung, Bereitschaftsprüfung und Auflösung verwenden weiterhin denselben Originaltext als BTS-Schlüssel. Nur der an den Sprachserver gesendete Text und die Prüfung seiner Antworten verwenden die Sprechfassung. Der persistente Sprachserver-Cache unterscheidet die neue ausgeschriebene Fassung von früheren Ziffernaufnahmen; unveränderte Texte bleiben wiederverwendbar. Die Umwandlung hat eine eigene Version in der vom BTS veröffentlichten Cache-Identität. Auch nach der Ausschreibung gilt die konfigurierte maximale Textlänge; ein zu langer Text wird vor der Einplanung abgelehnt und kann im Automatikmodus über den bisherigen Browser-Fallback ausgegeben werden.

Zum Aktivieren **BTS neu starten und alle Client-Seiten neu laden**. Texte mit Ziffern werden bei Bedarf neu vorbereitet. Vorhandene WAVs werden weder überschrieben noch gelöscht; am Sprachserver ist keine Änderung erforderlich.

## Kürzere Wortpausen beim Hallensprecher

Für die männliche Stimme liefert BTS eine Wiedergabekopie mit kürzerer Stille aus. Die bereits erzeugten WAVs, Ansagetexte und Generierungsschlüssel bleiben erhalten; eine neue Synthese ist dafür nicht erforderlich. Das gilt für tatsächliche Durchsagen und die Lautsprecher zum Probehören.

Zusätzlich spielt der Browser die lokale männliche Stimme mit dem Faktor 1,10 zur eingestellten Ansagegeschwindigkeit ab. Beim Standardwert 1,05 ergibt das eine Wiedergabegeschwindigkeit von 1,155. `preservesPitch` erhält dabei die Tonhöhe. Dieser Faktor gilt für jeden Sprachbaustein und für Hörproben. Die gesonderten Satz- und Kommapausen behalten ihre Dauer. Die Einstellung der Ansagegeschwindigkeit bleibt nutzbar; weibliche Stimme und Browser-TTS verwenden weiterhin ihren bisherigen Wert. Auch diese Tempoänderung benötigt keine Neugenerierung; nach dem Update die Ansageseite neu laden.

Anfang und Ende einer Aufnahme behalten etwa 30 ms stille Reserve. Innerhalb eines Bausteins ohne Satzzeichen oder Zeilenumbrüche werden nahezu stille Wortlücken ab 250 ms auf 100 ms begrenzt. Dadurch bleiben vollständige Namen gemeinsam gecacht und werden flüssiger gesprochen. Bei Bausteinen mit Satzzeichen oder Zeilenumbrüchen werden nur die Ränder gekürzt, damit innere Satzpausen erhalten bleiben. Die von BTS zusätzlich gesetzten Satz- und Kommapausen werden weiterhin berücksichtigt.

Die Verarbeitung erkennt PCM16-WAVs mit einem oder zwei Kanälen und zählt einen Bereich nur bei höchstens vier PCM-Stufen als still (etwa −78 dBFS). Alle Samples oberhalb dieser Schwelle bleiben unverändert und in ihrer Reihenfolge erhalten; kurze Lücken und stille Reserven an Wortgrenzen bleiben stehen. Rein stille, unbekannte oder nicht unterstützte Dateien werden unverändert ausgeliefert. Die weibliche Stimme verwendet die bisherige Originalauslieferung.

In 20 vorhandenen männlichen Namensaufnahmen fanden sich bei dieser konservativen Schwelle fünf Wortlücken über 250 ms, die längste etwa 755 ms. Eine vorhandene Namensaufnahme wurde dadurch von 2,24 s auf 1,445 s verkürzt. Alle Samples über der Stille-Schwelle wurden im Original und in der Wiedergabekopie bytegleich nachgewiesen. Diese Messung ersetzt keine akustische Hallenabnahme.

Die Variante ist Teil der signierten Audio-Berechtigung (`words-v1` beziehungsweise `edges-v1`). BTS verarbeitet sie beim WAV-Abruf, hält höchstens 16 MiB Wiedergabekopien im Arbeitsspeicher und unterstützt Range-/ETag-Abfragen für die tatsächlich ausgelieferten Bytes. Ein Download ist auf 16 MiB und die vorhandene Audio-Zeitgrenze begrenzt. Abbruch und Fehler geben den Downloadslot frei; vor hörbarer Ausgabe bleibt der bestehende Browser-Fallback verfügbar. Zum Aktivieren BTS neu starten und die Ansageseite neu laden. Die vorhandenen Aufnahmen können sofort verwendet werden.

## Datenfluss und Wiedergabe

- static/js/announcement_text.js enthält die gemeinsam verwendeten bisherigen Textfunktionen und leitet daraus die lokale Stückelung ab. Browser-Wortlaut, Namen, U17 und Satzzeichen bleiben erhalten.
- bts/speech/text.js rendert diese Funktionen nur zur Vorbereitung, ohne Wiedergabe.
- bts/speech/prefetch.js liest vorhandene Turnierdaten im Hintergrund und wartet auf freie Foreground-Arbeit.
- bts/speech/broker.js dedupliziert, priorisiert, schreibt Zahlen ausschließlich für die Sprachserver-Anfrage aus und pollt die versionierte API; bts/speech/http.js setzt einen vollständigen Request-Timeout.
- Die vorhandene /ws/admin-Verbindung bietet speech_prepare, speech_resolve, speech_status und die rein lesende speech_queue. Die Verbindung muss zuvor das betreffende Turnier erfolgreich geladen haben; Speech-Fehler beeinträchtigen den allgemeinen Verbindungsstatus nicht.
- bts/speech/proxy.js prüft zeitlich begrenzte, an Turnier und Audio-ID gebundene HMAC-Berechtigungen und reicht WAV/Range/ETag durch. Ohne gültige Signatur gibt es kein Audio.
- static/js/speech_service.js löst die lokalen Bausteine auf und entscheidet einmal je Wiedergabe-ID zwischen vorbereiteten WAVs und Browser-Fallback mit den ursprünglichen Textabschnitten. Nur vollständig bereite Batches werden als Server-Audio begonnen.
- static/js/announcements.js behält Queue, Claims, Leader und Pausen. Eine hörbar begonnene Ausgabe wird bei Fehlern nicht als vollständiger Ruf wiederholt. **Ansage stoppen** beendet aktive Ausgabe und verwirft ausstehende Ansagen.

Spätere Qwen-Abschlüsse füllen nur den Cache. Sie erzeugen keine neuen Wiedergabeereignisse. Mehrere erlaubte Geräte können dieselbe WAV je einmal nutzen. Ein einmal durch Nutzeraktion aktiviertes HTMLAudioElement wird für weitere Serverausgaben wiederverwendet.

Der Sprachserver liefert im Gesundheitscheck eine opaque configuration_version. Modell-, Voice-, Referenz-, Sampling- und relevante Bibliotheksänderungen invalidieren damit die lokalen BTS-Zuordnungen bei der nächsten Metadatenprüfung (15 Sekunden). Bevorzugte Varianten werden zusätzlich durch periodische Cache-Abfragen erneut berücksichtigt.

## Sicherheit und Betrieb

Die Browser erhalten nur kurzlebige Audio-Berechtigungen, keinen Sprachserver-Key. Die Generationsteuerung verwendet die **bestehende** BTS-Admin-WebSocket-Vertrauensgrenze. Der bisherige BTS hat keine allgemeine neue Benutzeranmeldung erhalten. Für Zugriff außerhalb des vertrauten Turniernetzes müssen dessen Admin-Zugriff und TLS im vorhandenen Deployment geschützt werden.

Der Audio-Proxy akzeptiert nur feste IDs, keinen Zielhost oder Dateipfad aus Browserdaten. Aktive Proxy-Downloads sind begrenzt; Verbindungsabbruch und Timeout geben den Slot frei. Neue Sprachsteuerungsanfragen werden ohne Textinhalt geloggt. API-Ausfälle, Überlastung und Neustarts lassen Spielverwaltung und vorhandene Realtime-Events weiterlaufen.

Aktuell werden nur deutsche Server-Stimmen angeboten. Englisch/Niederländisch bleiben beim bestehenden Browser-Provider, bis passende Profile und Sprachzuordnungen ausdrücklich geprüft sind.

## Tests

Für wiederholte akustische Vergleiche mit festem Spielruf gibt es einen [separaten Hörtest](tts-listening-lab.md). Er hält Kitten geladen, vergleicht vier Stückelungs-/Satzzeichenvarianten und erlaubt Änderungen von Pausen, Tempo, Seed und Sampling ohne Neustart des Produktivservers. Er schreibt ausschließlich eigene Testaufnahmen.

    ./node_modules/.bin/mocha test/test_speech_numbers.js test/test_speech_playback.js test/test_speech_text.js test/test_speech_browser.js test/test_speech_backend.js test/test_speech_readiness.js
    npm test

Ein ausdrücklich aktivierter End-to-End-Test nutzt eine temporäre In-Memory-BTS-Datenbank, die **echte** FastAPI mit einer kleinen Mock-Engine und einen separaten Headless-Chrome. Er verändert keine produktiven Turnierdaten und benötigt den installierten Sprachserver sowie Chrome:

    BTS_SPEECH_INTEGRATION=1 ./node_modules/.bin/mocha test/test_speech_end_to_end.js

Optional BTS_SPEECH_PYTHON und BTS_SPEECH_CHROME für andere Installationspfade setzen. Der Test prüft Vorabgenerierung, tatsächlichen geschützten WAV-Abruf und native HTMLAudio-Wiedergabe nach Nutzeraktion. Die vorhandenen Qwen-CPU-Hörproben stehen zusätzlich im separaten Sprachserver-Projekt bereit.

Bytegenaue Vergleiche aller bisherigen Ansagearten, geänderte Gegner, Queue-Grenzen, Authentifizierung/Signaturen, Cache-Misses, Ausfälle, Abbruch, Teilwiedergabe und Mehrfachclients sind automatisiert geprüft. Die akustische Hallenabnahme und die eingesetzten Mobil-/Kioskbrowser bleiben praktische Betreiberprüfungen.


## Prüfstand dieses Auftrags

Nach Ausschreiben der Zahlen vor der Sprachserver-Anfrage: 1071 BTS-Tests mit `mocha test/ --timeout 10000` bestanden; die dreizehn optionalen End-to-End-Fälle bestanden separat mit echter FastAPI und nativem Chrome (32 einschließlich der geteilten Texttests). Die Engine erhält unter anderem „Auf Spielfeld acht“, „Spiel Nummer siebzehn“ und „Jungeneinzel U siebzehn“, während die sichtbare Textliste ihre Ziffern behält. Vorbereitung und tatsächliche Wiedergabe teilen weiterhin dieselben Aufnahmen ohne weitere Synthese. Geprüft sind beide Stimmen, strenge Prüfung der ausgeschriebenen Serverantwort, Begrenzung nach der Expansion, deutsche Zahlwortformen, große Zahlen ohne Präzisionsverlust, führende Nullen, Tausenderpunkte, Dezimalkommas und unveränderte Browsertexte. ESLint bestand für alle geänderten JavaScript-Dateien.

Nach Erhöhung des männlichen Sprechtempos: 103 gezielte Sprachtests und alle dreizehn optionalen End-to-End-Fälle bestanden (32 einschließlich der geteilten Texttests); ESLint bestand für die geänderten JavaScript-Dateien. Der native Chrome spielt Durchsage und Hörprobe mit dem zusätzlichen Tempo-Faktor und erhaltener Tonhöhe ab. Der Sprachservice-Test prüft mehrere Bausteine, die bestehende Geschwindigkeitseinstellung und den Rückwechsel zur weiblichen Stimme. Vorhandene WAVs bleiben bytegleich, und das Abspielen löst keine zusätzliche Generierung aus.

Nach Kürzung der Stille beim Hallensprecher: 1059 BTS-Tests mit `mocha test/ --timeout 10000`, 102 gezielte Sprachtests und alle dreizehn optionalen End-to-End-Fälle bestanden (32 einschließlich der geteilten Texttests). Der neue native Chrome-Fall spielt dieselbe männliche Aufnahme regulär und als Hörprobe mit verkürzten Pausen ab; das Original-WAV im Sprachserver bleibt bytegleich und es gibt keine weitere Generierung. Prüffälle sichern die Samples oberhalb der Stille-Schwelle, leise Sprachanteile, kurze Lücken, Satzpausen, zusätzliche RIFF-Chunks und Stereo. Signaturen binden die Wiedergabevariante; Range-/ETag-Antworten passen zur bearbeiteten WAV. Zu große, abgebrochene und zeitlich überschrittene Downloads geben ihre Slots frei. Die Wiedergabekopien liegen nur im begrenzten BTS-Arbeitsspeicher und verändern weder Stimmenprofile noch Modellkonfiguration oder vorhandene Aufnahmen.

Nach einheitlicher Behandlung aller strukturierten Bausteine: 1050 BTS-Tests mit `mocha test/ --timeout 10000`, 93 gezielte Sprachtests und alle zwölf optionalen End-to-End-Fälle bestanden (31 einschließlich der geteilten Texttests). Der Regressionstest für Spiel 186 vergleicht normalen Spielruf und kampflose Entscheidung: beide verwenden dieselbe lokale Aufnahme; die Satz- beziehungsweise Kommapause bleibt getrennt erhalten. Ein zusätzlicher Test prüft den gesamten vorbereiteten Vorrat mit mehreren Runden, Nummern, Hallenvarianten sowie ein-/ausgeschaltetem Meetingpoint in Deutsch und Englisch auf reine Satzzeichen-Dopplungen. Initialen und ursprüngliche Namenszeichen bleiben geschützt. Die echte FastAPI erzeugt Nummern, Feldansagen, Startanweisung, Runden und Namen jeweils nur einmal; die tatsächlichen Browseraufrufe verwenden diese Aufnahmen. Der Sprachtest bleibt als vollständiger Originaltext vorbereitet und wird weiterhin lokal abgespielt.

Nach Beseitigung der Satzschluss-Dopplungen: 1048 BTS-Tests mit `mocha test/ --timeout 10000`, 91 gezielte Sprachtests und alle zwölf optionalen End-to-End-Fälle bestanden (29 einschließlich der geteilten Texttests). Im ersten Gesamtlauf überschritt der unveränderte 519-Spiele-Test die regulären zwei Sekunden; isoliert bestanden seine sechs Fälle in 999 ms. Die Wiederholung mit zehn Sekunden je Test bestand vollständig. Die echte FastAPI erhält jeden Namen nur einmal, ohne zusätzliche Ausrufezeichen-Variante. Ein nativer Chrome-Aufruf zur kampflosen Entscheidung spielt dieselbe geschützte WAV für den Namen in der Satzmitte und am Satzende, ohne neue Generierung. Geprüft sind außerdem die Wiederverwendung von Rundennamen, unveränderte Initialen und Namens-Endzeichen, die zusätzlich eingefügten Wiedergabepausen sowie Abbruch während einer Pause ohne weitere Ausgabe oder Fallback. Nach einem Gegnerwechsel wird nur der neue Name vorgemerkt. Browser-Textarrays bleiben bytegleich; für lokale Pläne wird der gesamte Inhalt einschließlich der als Grenzen geführten Satzzeichen gegen die bisherigen Texte verglichen.

Nach Wiederverwendung lokaler Sprachbausteine: 1044 BTS-Tests, 87 gezielte Sprachtests und alle elf optionalen End-to-End-Fälle bestanden (zusammen mit den geteilten Texttests: 26). Der Browser-Wortlaut wird weiterhin bytegenau gegen die eingefrorene Ausgangsversion verglichen, abgesehen von den bereits zuvor korrigierten Satzabständen. Für die lokale Stückelung prüfen dieselben Fälle alle Nicht-Leerraumzeichen in unveränderter Reihenfolge. Zusätzliche Fälle decken beide Gewinner, Einzel/Doppel, Hallenvarianten, Offizielle, Bereitschaft aller Bausteine und die vollständige ursprüngliche Browser-Ansage beim Fallback ab. Nach einem Gegnerwechsel kommen nur dessen Name und die benötigte Variante mit Satzschluss hinzu. Der echte Chrome spielt zwei Spielbeginn-Aufrufe mit verschiedenen Feldclips und derselben Startanweisung in korrekter Reihenfolge; die FastAPI erhält dabei keinen weiteren Generierungsauftrag.

Ein Vergleich der Vorabtexte mit Stand `a64cc85` für 16 aktive Felder und zwölf synthetische Spiele nach dem Test-Setup (unterschiedliche Matchnummern und Gegner, gleiche Offizielle/Disziplin/Runde/Halle) ergab 194 Aufnahmen mit 10.102 Zeichen vorher und 133 Aufnahmen mit 2.634 Zeichen danach. Das sind rund 74 % weniger zu synthetisierender Text, obwohl nun auch kampflose Entscheidungen vorbereitet werden. Die Einsparung hängt vom Turnier ab; sie ist keine gemessene Beschleunigung der Modellinferenz. Syntaxprüfung und geänderte neue Module sind lint-sauber; die 25 bereits vorhandenen ESLint-Meldungen in `announcements.js` bleiben unverändert.

Nach automatischer Cache-Anzeige und Fortschrittsbalken: 1040 BTS-Tests, 83 gezielte Sprachtests und alle zehn optionalen End-to-End-Fälle bestanden. Der neue Browserfall setzt die periodische Abfrage auf 60 Sekunden und prüft die schnelle Aktualisierung nach der tatsächlichen Abschlussmeldung. Cache-Zahl links, Liste und Balken bleiben konsistent; die Einstellungsseite wird dabei nicht neu aufgebaut und es erfolgt keine Audiowiedergabe. Ein gezielt fehlgeschlagener API-Auftrag zählt nicht als fertig. Bei einer fehlenden Statusantwort verschwindet der Balken und die Anzeige meldet den Ausfall. Abschlussmeldungen enthalten keine Ansagetexte oder Schlüssel; unveränderte fertige Aufnahmen erzeugen keine doppelten Meldungen.

Nach Korrektur der Satzabstände: 82 gezielte Sprachtests und alle neun optionalen End-to-End-Fälle bestanden. Die Tests vergleichen Cache und tatsächlichen Aufruf für Spielbeginn und Offiziellen-Zweitrufe, einschließlich noch nicht zugewiesener Felder und Aufrufe ohne Feld. Die echte FastAPI erhält den korrekt getrennten Text; dessen geschützte WAV ist abrufbar. Alle anderen Textbestandteile bleiben im Vergleich mit der eingefrorenen Ausgangsversion bytegleich. Die akustische Satzpause wird durch diesen Test mit Mock-Synthese nicht bewertet.

Nach der zentralen Stimmwahl auf der bestehenden Einstellungsseite: 1036 BTS-Tests und 79 gezielte Sprachtests bestanden. Alle neun optionalen End-to-End-Fälle bestanden separat mit echter FastAPI und nativem Chrome. Zwei Browser übernehmen Stimm- und Modusänderungen ohne Neuladen; die Auswahl bleibt nach einem Neuladen erhalten und alte lokale Browser-Vorgaben werden ignoriert. Nach dem Wechsel werden ausschließlich Aufträge der gewählten Stimme erzeugt. Geprüft sind außerdem beide bestehenden Speicherwege einschließlich ungültiger Werte, das Entfernen überholter Vorarbeit bei weiterhin genau einem offenen Serverjob, keine lokale Generierung im Browser-Modus sowie die Textliste und Hörproben auf der bestehenden Einstellungsseite. Beim Verlassen der Seite stoppt die Hörprobe sofort und die Listenabfrage endet.

Nach Ergänzung der Textliste mit Probehören: 1033 BTS-Tests und 76 gezielte Sprachtests bestanden. Die neun optionalen End-to-End-Fälle bestanden separat mit echter FastAPI und nativem Chrome. Der neue Browserfall vergleicht die angezeigte Liste mit der tatsächlichen BTS-Reihenfolge, prüft gesperrte Lautsprecher für unfertige Texte, spielt die geschützten WAVs beider Stimmen ab und bestätigt unveränderte Stimmwahl, Auftragsliste und Generierungsanzahl. Fremde Turniertexte bleiben ausgeblendet; nach dem Schließen enden die Listenabfragen. Zusätzlich geprüft sind Abbruch, Vorrang echter Durchsagen sowie die Ablehnung veralteter oder turnierfremder Hörproben.

Nach der Umstellung auf einen offenen Generierungsauftrag: 1025 BTS-Tests bestanden, acht optionale End-to-End-Fälle regulär deaktiviert. Separat bestanden diese acht Fälle mit echter FastAPI und nativem Chrome, einschließlich Stimmwechsel zur männlichen Stimme, deren Vorab-Cache und anschließender lokaler Wiedergabe. Während der Browserfälle wurde geprüft, dass vor Abschluss des aktuellen Jobs kein weiterer Generierungsauftrag gesendet wird. 68 gezielte Sprachtests und 81 Sprachserver-Tests bestanden. Parallele unterschiedliche Serveranfragen, Busy-Ablehnung ohne Jobanlage, Cache-Abruf während laufender Generierung, verlorene POST-Antworten und der Umstieg aus der alten Server-Warteschlange sind geprüft.

Am 15.10.2026 nach der Kitten-Anbindung: 1019 BTS-Tests und 62 gezielte Sprachtests bestanden; sieben optionale End-to-End-Fälle bleiben in der normalen Suite deaktiviert. Separat wurden diese sieben Fälle mit echter FastAPI/Mock-Synthese und nativem Chrome erfolgreich ausgeführt. Die neuen Backend-Tests prüfen erneute Vorbereitung nach dem Wechsel und das Verwerfen verspäteter Antworten des vorherigen Backends. Der Sprachserver bestand 79 reguläre Tests sowie separat zweimal den echten Kitten-CPU-Test mit beiden Stimmen, Worker-Wiederverwendung, geschütztem WAV-Abruf und persistenten Cache-Treffern nach Neustart.

Am 14.10.2026 nach der Fallback-Korrektur: vollständige BTS-Suite 1017 bestanden; sieben optionale End-to-End-Fälle darin standardmäßig deaktiviert. Zusätzlich bestanden 60 gezielte Text-, Provider-, Backend- und Anzeigetests sowie alle sieben separat aktivierten End-to-End-Fälle mit tatsächlichem BTS, FastAPI/Mock-TTS und nativem Chrome: Vorab-Cache und geschützter WAV-Abruf, Nutzeraktivierung/Audioausgabe, Cache-Markierungen am Vorbereitungsaufruf und an einer freien Ansage ohne Wiedergabe, lokale Ausgabe trotz verzögerter Resolve-Abfrage, sichtbarer Fallback bei Audio-Abruffehler, echter Spielaufruf über den bestehenden WebSocket ohne doppelte Wiedergabe sowie Cache-Wiederverwendung nach frischem Adapterstart.

Die neuen Regressionsfälle prüfen insbesondere die direkte lokale Wiedergabe eines grün markierten Vorbereitungsaufrufs im Automatikmodus mit über fünf Minuten alten Backend-Einträgen und künstlich verzögerter Resolve-Abfrage sowie einen tatsächlich im nativen Browser blockierten Audio-Download mit sichtbarem Fallback-Grund und entfernter grüner Markierung. Der tatsächliche WAV-Aufruf bleibt geschützt; originale Ansagetexte und Mehrfachwiedergabeschutz sind weiterhin geprüft.

Der Sprachserver bestand 54 Mock-Tests einschließlich Synthesekonfigurations-Invalidierung. Seine echte Qwen-CPU-Anbindung wurde zuvor mit beiden Referenzstimmen erfolgreich geprüft. Die lokale Verbindung ist im privaten config.json eingerichtet; der Sprachserver verwendet den vorhandenen geprüften Modellcache offline. Prozesse/Dienste werden für die Aktivierung durch den Betreiber gestartet bzw. neu gestartet.


## Kontextbasierte Generierung ab 16.10.2026

Mit aktualisiertem Sprachserver und lokalem Wortmodell verwendet BTS die [gemeinsame Kontextstrategie](context-tts.md). Sie ersetzt für deutsche strukturierte Turnieraufrufe die oben beschriebene kurze Stückelung und deren männliche Nachbeschleunigung: ganze Spielblöcke, aus vollständigen Quellen gewonnene Feld-/Teamstücke und längere gemeinsame Texte, einschließlich der D05-/D08-/D12-Korrekturen. Der Browsertext bleibt erhalten. Ältere Server bieten die Strategie nicht an und nutzen weiterhin die bisherige Anbindung.

## Zusätzliche Vorbereitung bei Leerlauf

BTS trennt benötigte Ansagen von bloß möglicher späterer Verwendung. Direkt beim Feld- oder Vorbereitungsaufruf wird das vollständige Paket des Spiels als **benötigt** aufgenommen: Spielblock, beide Teams, alle bekannten Offiziellen, Hallenvarianten, Zweitrufe, Spielbeginn und beide möglichen kampflosen Sieger. Dazu gehören die möglichen Tablet-/Klapptafelansagen beider Teams, auch schon während der Vorbereitung. Gemeinsame Feldreferenzen und feste Ansagebausteine gehören weiterhin zum regulären Bedarf; freie Texte und Sprachtests können ausdrücklich angefordert werden.

Die benötigten Spielpakete folgen dieser Reihenfolge:

1. Laufende Spiele nach `setup.called_timestamp`, ältester tatsächlicher Feldaufruf zuerst.
2. Spiele in Vorbereitung nach `setup.preparation_call_timestamp`, ältester Vorbereitungsaufruf zuerst.

Spielnummer und angesetzte Uhrzeit ändern diese Aufrufreihenfolge nicht. Bei gleichem Zeitstempel gilt die bestehende BTS-Sortierung; fehlt ein gültiger Aufrufzeitstempel, folgt das Spiel hinter denen mit bekanntem Zeitstempel. Beim Ruf nutzt BTS den zuletzt geladenen Turnierkontext, um die benötigten Bausteine synchron vor der Benachrichtigung der Clients einzutragen. Parallel wird die gespeicherte Planung ohne die sonstige 500-ms-Bündelung neu gelesen. Bei einem Kaltstart ohne geladenen Kontext erfolgt die Eintragung über diese sofortige Datenbankabfrage. Ein bereits vorgemerkter Reserveeintrag samt Quelle wird hochgestuft, ohne seine fertige Aufnahme erneut zu generieren.

Erst wenn keine reguläre Arbeit mehr offen ist, werden zusätzlich vorbereitet:

1. Aufrufkandidaten mit ihren vollständigen Spielpaketen und möglichen Tabletbedienern.
2. Noch nicht zugewiesene Bediener aus der Tablet-Warteliste.
3. Weitere bekannte Spielblöcke und Ansagen in der Reihenfolge der BTS-Liste; Tabletansagen weiterer Teams bleiben auf laufende Disziplinen begrenzt.
4. Weitere gemeldete Teams laufender Disziplinen ohne anstehende bekannte Paarung.
5. Weitere bekannte Schiedsrichter und Aufschlagrichter, einschließlich ihrer Vorbereitungsaufrufe und Hallenvarianten.
6. Alle übrigen bekannten möglichen Tablet-/Klapptafelbediener: Einzelpersonen und konfigurierte Paarungen aus sämtlichen Disziplinen, auch ohne anstehendes Spiel oder nach bereits abgeschlossenen Spielen. Dazu gehören die Einzelpersonen einer Doppelpaarung auch dann, wenn die üblichen Spielpakete die Paarung gemeinsam aufrufen. Vorbereitungsaufrufe und Hallenvarianten werden ebenfalls vorbereitet.

Diese späteren Spiele und Personen werden vorher nicht automatisch als benötigt vorgemerkt. Für Aufrufkandidaten und weitere Spiele gilt die BTS-Sortierung: geplanter Termin, bei gleichem Termin eine vorhandene manuelle Reihenfolge, danach Spielnummer. Bekannte Teams unvollständiger Paarungen behalten die Position ihres Spiels; unbekannte Namen werden ausgelassen. Die Platzhalterzeit `00:00` und fehlende Uhrzeiten folgen den vorhandenen Regeln der Spielliste. Kommt ein Team in mehreren Paketen vor, zählt sein dringendster Bedarf; identische Ansagen werden nur einmal vorbereitet.

Eine Disziplin gilt hier als laufend, wenn sie ein Spiel auf dem Feld, in Vorbereitung oder unter den aktuellen Aufrufkandidaten hat. BTS ordnet die BTP-Stufen der jeweiligen Disziplin zu; ohne Stufeninformationen verwendet es den Disziplinnamen. Gibt es noch keine aktiven Spiele, beginnt es mit der nächsten anstehenden Disziplin. Teams dieser Disziplinen behalten ihren Vorrang; Kandidaten anderer Disziplinen und zusätzliche Einzelpersonen folgen erst in der letzten Stufe. Diese letzte Stufe verwendet dieselbe Kandidatenliste wie die Fortschrittsanzeige und erzeugt nur bekannte Namen beziehungsweise Landesverbände. Doppelaufteilung, Landesverbandsansagen, Klapptafeln, Namensnormalisierung und die bestehenden Kontextaufnahmen gelten auch im Leerlauf. Unbekannte Gegner oder freie Ansagetexte werden nicht erfunden.

Der Leerlaufplan bleibt zunächst ein Inventar möglicher Texte. Erst ohne offene reguläre Arbeit übernimmt der Broker jeweils einen Baustein samt benötigter Quellaufnahme. Eine geänderte Spielreihenfolge gilt auch für bereits vorgemerkte Leerlaufbausteine und deren Quellen, solange diese noch nicht gestartet wurden. Auch Wartezeiten auf die Wiederholung fehlgeschlagener regulärer Arbeit werden nicht mit zusätzlicher Synthese gefüllt. Ein neuer regulärer Auftrag hat vor dem nächsten Leerlaufauftrag Vorrang; eine bereits angenommene Aufnahme oder eine Anfrage mit ungewissem Ausgang behält den einzigen Serverplatz bis zur Klärung. BTS verwendet intern die zusätzliche Priorität `idle`, an den unveränderten Sprachserver geht dafür `low`.

Vor einem Auftrag werden Speicher- und Festplattencache geprüft. Identische Texte und Quellaufnahmen werden wiederverwendet; fertiger Leerlaufvorrat bleibt dauerhaft gespeichert. Der Broker hält nur begrenzt viele Einträge im Arbeitsspeicher. Bei Platzbedarf kann er fertig auf Festplatte gespeicherte Leerlaufeinträge aus dem Arbeitsspeicher nehmen, ohne ihre Dateien zu löschen oder reguläre Aufträge zu verdrängen. Bei geändertem Bedarf, Disziplin- oder Stimmwechsel entfallen überholte, noch nicht benötigte Arbeiten. Bereits gestartete Aufnahmen dürfen fertig werden und bleiben im Cache.

Die Einstellungsseite kennzeichnet solche Einträge mit **„Nur bei Leerlauf“**. Die Gesamt- und Einzelbalken zeigen sechs getrennte Bereiche in dieser Reihenfolge:

1. **Blau – Vorrat im Cache:** fertiger, aktuell nicht benötigter Bestand außerhalb der folgenden Kategorie.
2. **Türkis – Vorsorglich erzeugt · diese Sitzung:** seit dem letzten BTS-Start tatsächlich neu erzeugte Bausteine, für die es in diesem Serverlauf noch keinen konkreten Bedarf gab. Ein Cache-Treffer des Sprachservers zählt nicht als neue Erzeugung. Neuladen der Seite oder weitere Clients setzen den Zähler nicht zurück; beim BTS-Neustart werden diese fertigen Dateien zum bisherigen blauen Vorrat.
3. **Dunkelgrün – Benötigt · aus Cache.**
4. **Hellgrün – Benötigt · neu erzeugt.**
5. **Orange – Beauftragt:** noch nicht fertige Aufträge.
6. **Grau – Noch ohne Auftrag:** bekannte Möglichkeiten und noch unbekannte Spiele.

Sobald ein vorsorglich erzeugter Baustein konkret benötigt wird, wechselt er in den grünen Bereich. Entfällt dieser Bedarf später wieder, gehört er zum blauen Vorrat und nicht erneut zur Kategorie „noch nie benötigt“. Das gilt auch nach Entfernen eines fertigen Eintrags aus dem Arbeitsspeicher. Die Zahl „Aktuell benötigt“ enthält keine bloße Leerlaufreserve; diese wird daneben gesondert ausgewiesen. Neue Balken verändern weder Generierungsreihenfolge noch Audio-Cache.
