# Zentrale Logs und Fernaktualisierung

Die Seite `/admin/diagnostics/` ist über **Logs & Geräte** im Turniermenü und
am Ende der Adminseite erreichbar. Sie verwendet dieselbe Adminverbindung wie
die übrige Turnierleitung. Protokolle lassen sich nach Quelle, Stufe, Text,
Zeitraum und einer einzelnen Seite filtern, pausieren und als JSON exportieren.
Das Detailprotokoll schaltet sich nach zehn Minuten wieder ab. Es erfasst
zusätzlich die tatsächlich ausgegebenen Info-/Debugmeldungen; bestehende
separate Diagnoseoptionen für einzelne Turnierabläufe bleiben wirksam.

Erfasst werden Warnungen und Fehler des BTS-Hauptprozesses, Konsolenausgaben
des Sprachprozesses sowie JavaScriptfehler und Warnungen aller angebundenen
Admin-, Planungs- und BUP-Seiten. Sprach-Fallbacks werden mit Grund und
Wiedergabekennung protokolliert, dazu Anfang und Ende einer Durchsage.
BTP-Verbindungsfehler erscheinen bei den BTS-Servermeldungen. Die eigenständigen
internen Logdateien externer BTP-/Pythonprogramme werden nicht ausgelesen;
Fehler der Sprachserverkommunikation und Generierung meldet der BTS-Adapter.

Eine Seite registriert sich separat unter `/ws/diagnostics`; normale
Spielstandnachrichten erhalten dadurch keine zusätzlichen Nachrichten oder
Datenbankzugriffe. Die Verbindung akzeptiert keine Admin-/Neuladebefehle.
Diese laufen über den vorhandenen Admin-WebSocket. WebSocket-Verbindungen
zum Diagnosekanal prüfen einen vorhandenen Origin gegen den Host. Bei einem
Reverse Proxy muss der öffentliche Host erhalten bleiben.

## Laufzeit und Grenzen

Die Logspeicherung läuft in einem eigenen Node.js-Kindprozess mit eigenem
libuv-Pool. Der Hauptprozess erfasst kleine, begrenzte Datensätze, bündelt bis
zu 50 pro IPC-Sendung und wartet vor dem ersten Versand auf Punktpriorität.
Es gibt keine synchronen Dateischreibvorgänge und keine zusätzlichen
Turnier-/Matchlocks für Logs. Der Logprozess verarbeitet Filter, Wiederholungen,
Export und Dateirotation. Exportantworten enthalten höchstens 200 Datensätze;
eine unveränderliche Exportauswahl wird im Browser paketweise zusammengesetzt.
Dadurch muss der Hauptprozess keinen vollständigen großen Export auf einmal
dekodieren. Maximal vier Exporte bleiben bis zu zwei Minuten im Logprozess.

Standardmäßig werden bis zu 5.000 Meldungen für höchstens sieben Tage
vorgehalten. Auf Platte gibt es drei rotierende Dateien mit jeweils maximal
2 MiB unter `<Datenbankverzeichnis>/diagnostics/events[.1|.2].jsonl`.
Die kleinste dieser Grenzen bestimmt den verfügbaren Verlauf. Wiederholungen
gleichen Inhalts und Kontexts innerhalb von zehn Sekunden aktualisieren den
Zähler; der Export enthält diese zusammengefassten Datensätze. Empfangszeit
auf dem BTS-Server und ursprüngliche Clientzeit werden getrennt geführt.
Beschädigte letzte Dateizeilen nach einem Abbruch werden ignoriert.

Der Hauptprozess puffert höchstens 1.000 Meldungen, Clients höchstens 200 und
beim Seitenwechsel höchstens 100 in der jeweiligen Sitzung. Empfangene
Clientpakete werden bestätigt; wiederholte Ereigniskennungen werden im
Logprozess dedupliziert. Bei Überlast werden Meldungen verworfen und ein
Zähler angezeigt. Dateischreibfehler werden sichtbar. Die asynchrone
Speicherung kann bei einem abrupten Prozess-/Systemabbruch den jüngsten noch
nicht geschriebenen Teil verlieren. Bestehende Terminalausgaben bleiben
verfügbar; der Monitor für unbehandelte Serverfehler verändert das normale
Abbruchverhalten nicht.

Bekannte Schlüssel für Zugangsdaten werden in strukturierten Werten maskiert;
auch übliche Token-/Passwortmuster in Texten und URLs werden bereinigt.
Objektgröße, Tiefe, Nachrichtengröße und Paketrate sind begrenzt. Die
Diagnoseansicht bietet denselben Zugangsumfang wie die vorhandene Adminseite.

Optionale Konfiguration:

```json
"diagnostics": {
  "enabled": true,
  "directory": "/absoluter/pfad/diagnostics"
}
```

Ohne persistente Datenbank und ohne `directory` bleibt der Verlauf nur im
Logprozess. `enabled: false` schaltet die Erfassung und HTML-Einbindung ab.

## Geräte, Ansichten und Neuladen

Eine Gerätekennung gilt für ein Browserprofil desselben Ursprungs und liegt
im lokalen Browserspeicher. Unterschiedliche Browserprofile desselben Rechners
erscheinen getrennt. Jede Seite hat zusätzlich eine Sitzungskennung; Iframes
verwenden eigene Speicherplätze. Verbindungskennung und geladene Dateiversion
zeigen, ob eine Seite tatsächlich neu gestartet wurde. Heartbeats laufen alle
15 Sekunden; nach 60 Sekunden ohne Kontakt gilt eine Seite als getrennt.
Getrennte Einträge bleiben bis zu einer Stunde sichtbar. Bereits geöffnete
Seiten ohne Diagnoseunterstützung benötigen zunächst einmal manuelles Neuladen.

Ziele sind eine Seite, alle Seiten eines Geräts, ein Seitentyp, ein Turnier
oder alle bekannten Seiten. Offlineziele werden als nicht erreichbar markiert
und erhalten bei einer späteren Verbindung keinen alten Neuladebefehl.
Seiten beginnen um jeweils 250 ms versetzt. Aufträge gelten zehn Minuten;
wartende Ziele lassen sich abbrechen. Ein neuer Auftrag für dieselbe Seite
ersetzt einen noch wartenden Vorgänger. Der Verlauf hält höchstens 100
Aufträge im Hauptprozess und wird beim Serverneustart nicht wieder ausgeführt.

Vor dem Neuladen prüft der Client ungespeicherte Formulare, laufendes Audio
und eingebettete Ansichten. Zähltablets warten konservativ bis zum bestätigten
Spielabschluss. Der Server prüft anschließend über eine geordnete Leseabfrage,
ob das beendete Spiel samt identischen Zähleingaben gespeichert ist. Direkt
vor der Navigation prüft der Client erneut auf Änderungen. Zwischenzeitliche
Eingaben oder ein abgebrochener Auftrag können die Freigabe somit aufheben.
Die Navigation sperrt neue Eingaben, erhält Pfad und Hash und fordert HTML
mit einer neuen Kennung an. HTML wird ohne Cache geliefert, lokale Skripte und
Stylesheets tragen die beim BTS-Start ermittelte Dateiversion.

## Prüfung

`test/test_diagnostics.js` prüft Prozessisolation, Persistenz, Rotation,
Exportpakete, Maskierung, Quittungen, Zielauswahl, Abbruch und die Schutzregeln.
Die Browserfälle in `test/test_speech_end_to_end.js` laufen mit
`BTS_SPEECH_INTEGRATION=1` und prüfen zusätzlich eine echte Adminseite,
die zentrale Bedienoberfläche und eine BUP-Anzeige in Chrome. Alle Tests
verwenden temporäre Daten und eigene Testprozesse.
