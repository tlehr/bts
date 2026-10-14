# Lokaler BTS-Sprachserver: Integrationsanalyse

Stand: 14.10.2026. Diese Dokumentation liegt auf **feat/localTts**.
Der eigenständige Python-Dienst befindet sich im separaten Repository
bts-sprachserver. Dieser Commit ändert keine BTS-Spielverwaltung oder Sprachausgabe.

## Bestehende Eingriffspunkte

| Bereich | Tatsächliche Stellen |
|---|---|
| Textbildung und Browser-TTS | static/js/announcements.js: announceNewMatch, announcePreparationMatch, create*-Builder, normalizeNames, playAnnouncementBatch |
| Wiedergabe-Queue und Tab-Koordination | announcementPlaybackQueue, announce, processAnnouncementPlaybackQueue, ensureAnnouncementLeaderLock, claimAnnouncementPlayback, requestAnnouncementRetry |
| Ereignisdispatch und IDs | static/js/change.js: _announcement_claim_key, _attach_setup_announcement_claim, _handle_announcement_event |
| Realtime | static/js/conn.js: immediate_change_types und /ws/admin; bts/wshandler.js; bts/admin.js: notify_change, _announcement_ts |
| Fachrufe | bts/match_utils.js: call_match, call_match_in_preparation, auto_call_matches_on_free_courts |
| Vorabkandidaten | bts/preparation_selection/selection_reads.js, automatic.js, status.js |
| Freie Ansagen | bts/admin.js: handle_free_announce; static/js/ctournament.js: trigger_registration_announcement |
| Einstellungen | ctournament.render_enable_announcements_content, lokale Standort-/Ansagetyp-Auswahl, announcement_speed, announcement_pause_time_ms und Display-/View-Regeln |
| HTTP/Deployment | bts/bts.js: create_app; bts/http_api.js; Dockerfile, config.json.default, install-service.sh |

Die bestehenden Match-Ansagen werden im Browser aus mehreren Strings aufgebaut.
Jeder nichtleere Teil wird separat an SpeechSynthesisUtterance übergeben.
Backend-Vorabgenerierung muss deshalb zuerst die vollständige Textparität der
vorhandenen Builder absichern. Ungeprüftes Zusammenfügen oder Nachbauen würde
Trennzeichen, Pausen oder bestehende Namensnormalisierungen verändern.

## Vorgesehene Integration

Der Turnierserver bleibt führend für Texte, Spielaufrufe, Wiedergabezeitpunkte,
Geräteziele und die vorhandene Client-Queue. Der Sprachserver erzeugt nur Audio
über eine authentifizierte v1-API und löst keine Wiedergabe aus.

Nach der bisherigen Analyse passt ein serverseitiger HTTP-Adapter mit
gleichursprünglichem Audio-Proxy zur bestehenden Express-/HTTPS-Struktur.
Ein allgemeiner berechtigungsgeprüfter Audio-Proxy existiert noch nicht; dessen
Autorisierung muss ausdrücklich festgelegt werden. API-Keys bleiben im Backend.
Keine zusätzliche konkurrierende WebSocket-Infrastruktur.

Ein SpeechService soll Browser-, Server- und Automatikmodus anbieten. Vorhandene
Queue, Pausen, Claims, Tab-Leader, Standortwahl und View-Unterdrückung bleiben
erhalten. Im Automatikmodus wird bei fehlendem Audio nach kurzer konfigurierbarer
Prüfung auf Browser-TTS zurückgefallen. Eine Wiedergabe-ID entscheidet genau
einmal; später fertig gewordenes Qwen-Audio füllt nur den Cache.
Hörbar begonnene Audioausgabe darf bei einem Fehler keinen vollständigen
erneuten Spielruf auslösen.

Stille Vorabgenerierung ist vom bereits hörbaren Fachereignis
match_preparation_call getrennt. Text-/Setup-/Offiziellen-/Settingswechsel
invalidieren alte Audiozuordnungen. Die existierende englische Browser-Sprache
en-EN benötigt eine explizite Zuordnung zu später freigegebenen en-GB/en-US-
Profilen; derzeit bleibt dafür Browser-TTS.

## Folgende Arbeit und Abnahme

1. Vollständige Vergleichsfixtures für alle bestehenden Ansagetexte erstellen.
2. Backend-Client, berechtigungsgeprüften Proxy, Timeouts und begrenzte Retries
   implementieren.
3. Provider hinter die vorhandene Sprachausgabe setzen; browser bleibt zunächst
   Standard und jederzeitiger Rollback.
4. Begrenzten Prefetch an stabile künftige Strings anbinden, ohne Fachrufe oder
   Foreground-Arbeit zu blockieren.
5. Mehrfachclients/Tabs, Autoplay, Abbruch, Cache-Misses, Dienstneustart und
   späte Qwen-Ergebnisse auf Desktop/Mobil/Kiosk testen.

Die maßgeblichen ausführlichen Dokumente liegen im Sprachserver-Repository:
docs/integration-bts-turnierserver.md, docs/integration-checklist.md,
docs/api.md und docs/openapi.json. Der Python-Dienst und seine Modell-/Audio-
Dateien werden nicht in dieses Node-Repository aufgenommen.
