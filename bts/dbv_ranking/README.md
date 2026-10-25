# DBV-Ranglistenimport

In der Hauptfeld-Kontrolle öffnet „Punkte aus DBV-Rangliste beziehen“ die Auswahl
für DBV U19/O19, den aktuellen Stand und die über „Archiv laden“ verfügbaren
Kalenderwochen. Die Datei wird direkt von `turniere.badminton.de` geladen.

Die Standardauswahl verwendet U19 für Jugendkonkurrenzen bis U19 und O19 für
die übrigen Konkurrenzen, einschließlich U22 und der Altersklassen. Die
Checkboxen bestimmen für jeden Import ausdrücklich, für welche Konkurrenzen
die Datei gilt. Ein späterer Import ersetzt nur die ausgewählten Konkurrenzen;
andere behalten ihren bisherigen Ranglistenstand.

Die Zuordnung verwendet Spieler-ID und Disziplin. Ohne Spieler-ID werden
normalisierte Namen, Geburtsjahr und Verein geprüft. JE/ME/JD/MD werden auf
HE/DE/HD/DD abgebildet; im Mixed gelten HM und DM je Spieler. Spieler ohne
Eintrag erhalten 0 Punkte. Mehrdeutige Treffer und unbekannte Disziplinen
bleiben offen und erscheinen im Importbericht. Für die Setzprüfung werden
die Punkte beider Partner addiert, sobald beide Werte feststehen.

`parse.js` liest das DBV-Excel-Format, `index.js` lädt die öffentlichen Dateien
mit Größen- und Zeitlimits. Excel-Verarbeitung und Zuordnung laufen über
`worker.js` in einem eigenen Worker. Die Admin-Handler speichern Rang,
Punkte, Quelle, Kalenderwoche, Abrufzeit und Zuordnungsbericht pro Konkurrenz
unter `registration_dbv_rankings`. BTP-Detaildaten bleiben separat gespeichert.
Ein Turnierreset entfernt die importierten DBV-Daten; ein Reset oder geänderte
Meldungen während eines Downloads verhindern dessen Übernahme.

Prüfung: `npx mocha test/test_dbv_ranking.js test/test_admin_registration.js
test/test_registration_xlsx_worker.js test/test_admin_tournament_reset.js`
