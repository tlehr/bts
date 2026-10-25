BTS-Sprachhelfer fuer Windows 11 x64

1. Die einzelne BTS-Sprachhelfer-Windows.exe herunterladen und oeffnen.
   Keine ZIP entpacken und keine Begleitdateien selbst verwalten.
   Die EXE entpackt kleine Hilfsdateien temporaer, oeffnet das Helferfenster
   und entfernt diese Dateien nach dem Schliessen. Der temporaere Pfad
   steht in den Hinweisen. Modelle und Einstellungen liegen getrennt davon.
   Die EXE ist noch nicht digital signiert; Windows kann eine Warnung zeigen.
2. Im Windows-Fenster zuerst die Hinweise zu lokalen Aenderungen,
   Datenaustausch, Stoppen und Entfernen lesen. CPU-Kerne und die
   Modell-RAM-Abbruchgrenze selbst waehlen. Erst Starten beginnt die Arbeit.
3. Der Starter prueft WSL, Prozessor und freien Arbeitsspeicher selbst.
   Falls WSL fehlt, bietet er die einmalige Einrichtung mit Windows-UAC an.
   Danach wird WSL erneut geprueft. Ist es bereit, geht es direkt weiter.
   Falls ein Neustart noetig ist: BTP vorher regulaer speichern/beenden.
   Bei noch ausstehender Einrichtung erscheint Erneut pruefen.
4. Die fertige Laufzeit wird vom BTS geladen und per SHA-256 geprueft.
   Das Fenster zeigt Prozent, Datenmenge und Downloadgeschwindigkeit.
   Pro neuer Laufzeitversion kann der Download erneut erforderlich sein.
   Es wird eine eigene WSL-Installation erstellt. Vorhandene Distributionen,
   Docker-Einstellungen und BTP werden nicht umkonfiguriert.
5. Das Fenster offen lassen. Im BTS unter Turniereinstellungen > Aufrufe >
   Sprachhelfer eine Testaufnahme fuer diesen Rechner anfordern.
   Unter Aktueller Auftrag stehen Text, Stimme und Laufzeit. Erzeugen,
   Uebertragen, Abschluss, Fehler und Abbruch sind getrennt sichtbar.
   Der letzte Auftrag bleibt mit seinem Ergebnis sichtbar, bis ein neuer beginnt.
6. Stoppen beendet den Helfer. Ein Download bleibt zum Fortsetzen erhalten;
   eine laufende WSL-Einrichtung wird zuerst abgeschlossen.
7. Helfer entfernen loescht nach Bestaetigung die eigene lokale Installation
   fuer diesen BTS samt Download und Modellen. WSL und andere Distributionen
   bleiben erhalten. Die heruntergeladene EXE nach dem Schliessen selbst loeschen.
   Ruecknahme der WSL-Einrichtung: siehe RUECKNAHME.txt.

Der erste Download umfasst Modelle und private vorbereitete Stimmprofile.
Die persoenliche EXE mit ihren Kopplungsdaten nicht oeffentlich weitergeben.
Die Kopplung ist acht Stunden gueltig; danach bei Bedarf neu herunterladen.
Nach erfolgreicher Kopplung kann derselbe Starter weiterverwendet werden.

Die CPU-Wahl begrenzt den Helfer auf die gewaehlten Kerne (1 bis 16,
hoechstens die verfuegbaren Kerne, Vorgabe 2). Die Modell-RAM-Abbruchgrenze
ist von 2560 bis 16384 MiB waehlbar, Vorgabe 3584 MiB. Sie wird etwa alle
250 ms bei Modellstart und Generierung ueberwacht; bei Ueberschreitung wird
der eigene Modellprozess beendet.
Kurzzeitiges Ueberschreiten ist moeglich. WSL und Dateicaches brauchen
zusaetzlichen Speicher. Andere WSL-Programme werden nicht umkonfiguriert.
Ressourcen aendern: erst Stoppen, dann neue Werte waehlen und Starten.
Das Fenster misst beim Oeffnen fuenf Sekunden lang nur lesend lokale CPU-Last
und freien Speicher. Messwerte bleiben auf diesem Rechner. Der Vorschlag
laesst Reserven fuer weitere Nutzung; er gilt fuer 60 Sekunden und wird nur
mit Vorschlag uebernehmen eingetragen. Manuelle Werte bleiben sonst erhalten.
Last neu messen ist vor dem Start oder nach Stoppen moeglich. Der Reiter
Ressourcen zeigt Messung und Reserven. Bei hoher Last oder wenig Speicher
empfiehlt das Fenster zu warten. Es ist keine Garantie fuer unbeeintraechtigte
Nutzung. Das bestehende Paket nutzt ausschliesslich die CPU, keine GPU.
Ein laufendes BTP kann bleiben; eine ggf. erforderliche WSL-Einrichtung mit
Neustart muss ausserhalb des laufenden Turnierbetriebs erfolgen.

Freie Helfer erhalten automatisch regulaere Kontextaufnahmen sowie angeforderte
Testaufnahmen. Die Texte koennen Spielernamen enthalten. Der Sprachserver
prueft die Aufnahmen zentral und erzeugt daraus die fertigen Audiobausteine.
Eine lokale Abschlussmeldung bestaetigt die Uebertragung; die zentrale Pruefung
kann noch ausstehen. Die EXE braucht nach den Paket-/Entpacktests noch
einen praktischen Starttest auf Windows.
