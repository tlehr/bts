# Einheitliche BTS-Oberfläche – klickbare Designvorschläge

Stand: 27. Oktober 2026. Die verlinkten Mockups bleiben eine simulierte Diskussionsgrundlage. Die ausgewählte Turnierleitung aus Konzept A ist inzwischen in die echte Oberfläche übertragen; Details und aktuelle Bildschirmbilder stehen unter [Umsetzung der Turnierleitung](umsetzung/README.md).

## Vorschau öffnen

- Galerie: `/static/mockups/admin/index.html`
- Konzept A: `/static/mockups/admin/app.html?konzept=a#leitstand`
- Konzept B: `/static/mockups/admin/app.html?konzept=b#leitstand`

Die Dateien liegen in `static/mockups/admin/`. BTS liefert sie über seine bestehende statische Route aus; dafür ist keine Änderung am Server nötig. Die Galerie lässt sich auch direkt als lokale HTML-Datei öffnen. Die Darstellung verwendet lokale CSS-, JavaScript- und SVG-Dateien. Es gibt keine API-Abfragen, WebSockets, echten Downloads oder Audiowiedergabe. Sämtliche Turnierdaten und Dialogaktionen sind simuliert und bleiben nur im Arbeitsspeicher der jeweiligen Vorschauseite. Die persönliche Kachelanordnung wird beim Übernehmen im lokalen Browserspeicher dieses Geräts gespeichert.

## Empfehlung und Alternative

**Ausgewählte Richtung A: kompakte obere Navigation.** Sechs feste Bereiche, darunter die jeweilige Bereichsnavigation. Die Hauptseite behält die volle verfügbare Breite. Das passt besonders gut zu 13 Feldern und vielen gleichzeitig benötigten Informationen. Meine Empfehlung für BTS.

**Alternative B: einklappbare Seitennavigation.** Dieselben Bereiche und dieselben Komponenten, aber mit dauerhaft sichtbarer dunkler Seitenleiste. Sie unterstützt häufige Wechsel zwischen Werkzeugen. Die ausgeklappte Leiste beansprucht 226 Pixel; der Fokusmodus reduziert sie auf eine Symbolleiste. Bei geringer Bildschirmbreite erfolgt diese Reduktion automatisch.

Die Auswahl oben im Mockup wechselt zwischen A und B und behält die aktuelle Seite. Die Vorschläge unterscheiden sich bewusst im Navigationsrahmen; ihre fachlichen Funktionen und Seiteninhalte sind gleich.

## Gestaltungsregeln

- Helle, ruhige Flächen und ein dunkles Grün als gemeinsame Grundfarbe. Wiederverwendung des vorhandenen Feldsymbols.
- Vorhandene BTP-Highlights haben Vorrang: Ein 3 Pixel breiter Rand links zeigt die gespeicherte Highlight-Klasse des Spiels in voller Farbe. Der Zeilenhintergrund erhält bei Spielen in Vorbereitung 40 Prozent dieser Farbe auf dem jeweiligen Weiß-/Grauton; andere explizite BTP-Highlights verwenden 18 Prozent. Bei Vorbereitungsaufrufen entspricht die Farbe der konfigurierten Halle. Die sechs Farben werden nicht pauschal auf neue Spielstatus umgedeutet.
- Gelb ist eine Signalfarbe für Handlungsbedarf und passende Drag-and-drop-Ziele. Freie Felder erscheinen gelb mit einer klaren Zuweisungsaktion. Während des Ziehens werden geeignete freie Felder stärker, das Ziel unter dem Mauszeiger am stärksten hervorgehoben. Normal laufende Spiele erhalten dadurch keine gelbe Statusfarbe.
- Die Ergebnisbestätigung ist ein grüner Knopf mit weißer Schrift. Eine gerade, 3 Pixel breite grüne Kante am rechten Zeilenrand zeigt davon unabhängig den Vorbereitungsbedarf an, passend zur gelben Kante links an freien Feldern. Ein gut sichtbarer grüner Verlauf unterstützt die Markierung in der letzten Zelle. Die Zeilenenden sind nicht abgerundet; Hallen-Highlights und gelbe freie Felder behalten ihre Bedeutung.
- Nicht zugewiesene Spiele erhalten rechts ebenfalls eine gerade Kante mit Verlauf für den Aufrufstatus: Blau für mögliche automatische Vorbereitungsaufrufe innerhalb der Grenze, Grün für mögliche Feldaufrufe und Rot für blockierte Aufrufe. Außerhalb der automatischen Aufrufgrenze bleibt die Fläche neutral. Das Info-Icon zeigt beim Überfahren die Prüfung je Aufrufart, Bedingungen und Aufrufgrenze; per Klick oder Tastatur öffnen sich dieselben Angaben im Dialog. Hallenfarbe und Audioindikatoren bleiben eigenständige Anzeigen. Die Beispieldiagnose reagiert auf den Check-in im Mockup; eine produktive Umsetzung verwendet die vorhandenen Serverdiagnosen.
- Die rechten Statusverläufe sind in der Mitte zu 46 Prozent und am Rand zu 92 Prozent deckend; bei Hover oder Tastaturfokus steigen diese Werte auf 58 beziehungsweise 98 Prozent. So setzt sich der Aufrufstatus deutlich von der Hallenfarbe ab. Die gerade, drei Pixel breite rechte Kante verwendet einen deutlich dunkleren Ton derselben Statusfarbe, bei Hover und Tastaturfokus nochmals dunkler.
- Die rechten Feldaktionen haben eine gemeinsame Breite von 104 Pixeln. „Bestätigen“ und „Zuweisen“ füllen diese Breite; Gesamtaufruf und Spielbeginn-Durchsage erhalten zwei gleich breite, umrandete Knöpfe, die einschließlich ihres Abstands zusammen ebenfalls 104 Pixel breit sind. Die Knöpfe sind innerhalb der gewählten Tabellendichte gleich hoch.
- In den Spieltabellen der Turnierleitung entfallen die Status-Badges unter Zeit, Disziplin und Runde. Der Zustand bleibt für Screenreader und im gemeinsamen Spiel-Dialog verfügbar. Hallenfarben, Personenhinweise, Timer und verfügbare Aktionen dienen in der Tabelle als Orientierung. Andere Ansichten wie die Sprachvorbereitung behalten ihre Statusbeschriftungen und Filter. Rückmeldungen wie Audio „Bereit“ und Warnungen bleiben als eigene, beschriftete Bedienelemente erkennbar.
- Anwesenheit und Verfügbarkeit der einzelnen Personen erscheinen als kompakte Namensmarkierungen mit 4 Pixeln Radius und dünner Kante. Zur besseren Unterscheidung bei Rot-Grün-Schwäche steht „Anwesend“ auf dunklem Petrolgrün mit weißer Schrift; „Noch nicht anwesend“ behält die bisherige helle rote Fläche mit dunkelroter Schrift und Kante. Die Helligkeit und die weiße gegenüber der dunklen Schrift unterscheiden die Zustände zusätzlich. Die Namensmarkierungen verwenden keine zusätzlichen Anwesenheitssymbole. Die BTP-Hallenfarben und die gelbe Kennzeichnung eines anderen Spieleinsatzes behalten ihre Bedeutung. Ein BTP-Sperrvermerk verwendet weiterhin eine dunkelrote Kante und einen deutlich abgesetzten Code. Die Umrandung ersetzt den bisherigen vertikalen Innenabstand, damit die Markierungen kompakt bleiben. Anklickbare Namen werden beim Überfahren durch eine zusätzliche Kontur hervorgehoben; Status und Bedienbarkeit bleiben pro Person getrennt.
- Feldsymbol, aktive oder wartende Tabletbindung, BTP-Sperrcode und verbleibende Pausenzeit stehen innerhalb derselben Namensmarkierung. Eine dezente Trennkante gliedert Name und Zusatzangaben. Spieler-Pausentimer verwenden eine kompakte Anzeige mit rotem Hintergrund, weißer Uhr und weißen Ziffern in Siebensegmentschrift. Tooltip und zugängliche Beschriftung beschreiben die Person einschließlich Einsatz und Restpause; gesperrte Personen bleiben ohne Check-in-Knopf.
- Schiedsrichter und Aufschlagrichter erhalten unterschiedliche Rollen-Icons ohne Buchstabenkürzel: Schiedsrichter auf dem Hochstuhl beziehungsweise Aufschlaghöhenmessgerät mit Sichtplatten, Messlinie und Stativ. Die Gestaltung des Messgeräts orientiert sich am [BWF-zugelassenen Gerät von Yonex](https://www.yonex.com/fixed-service-height-tool-bwf-approved). Rollen-, Tablet- und Zuweisungssymbole in der Offiziellenspalte sind einheitlich 22 Pixel hoch. Die Aufrufglocken verwenden dieselben 12 Pixel und dieselben Knopfmaße wie bei den Spielern. Tooltip und zugängliche Beschriftung nennen die Rolle; die Zuweisung öffnet das passende Eingabefeld. Ein fester, 26 Pixel breiter Platz für die Rollen-Icons richtet Namen und Namensmarkierungen bündig aus, auch bei Tablet-Paarungen. Als Paarung aufgerufene Tabletbediener erscheinen in einer gemeinsamen Namensmarkierung mit einem gemeinsamen Check-in und Zweitaufruf. Ein Klick oder die Tastatur schaltet beide Personen zusammen ein oder aus; einzeln aufgerufene Tabletbediener behalten ihren eigenen Check-in. Die Gruppierung ist in den Beispieldaten ausdrücklich hinterlegt und wird nicht allein aus zwei vorhandenen Namen abgeleitet.
- Die sichtbaren Timerziffern sind optisch vertikal zentriert. Der Leerraum der vorhandenen Siebensegmentschrift wird für die große und die kleine Schriftgröße getrennt ausgeglichen; Anzeigefläche und Zeilenhöhe ändern sich dabei nicht. Uhrsymbol und sichtbare Ziffern liegen dadurch auf derselben Mittelachse.
- Vorbereitungstimer sind einschließlich Schrift und Uhrsymbol um etwa 20 Prozent verkleinert. Sie verwenden die volle Hallenfarbe für Ziffern, Uhrsymbol und einen dünnen Rahmen. Die Fläche innerhalb des Rahmens zeigt probeweise den neutralen Weiß-/Grauton, den die Zeile ohne Hallenfarbe hätte, einschließlich Streifenschattierung und Hover. Ohne Hallenfarbe bleibt die schwarze Anzeige erhalten.
- Eine Schriftfamilie, dieselben Abstände, Buttons, Tabellenköpfe, Formulare, Dialoge, Fehlermeldungen und Ladezustände.
- Tabellen wechseln bei neutralen Zeilen zwischen Weiß und einem hellen Grau als Lesehilfe. Auch die leicht eingetönten Hintergründe farbiger Zeilen folgen diesem Muster; die volle BTP-Farbe steht am linken Rand. Mauszeiger und Tastaturfokus dunkeln den bestehenden Hintergrund zusätzlich um acht Prozent ab. Der Hover-Effekt ersetzt die Streifenschattierung nicht: Eine bereits schattierte Zeile bleibt auch beim Überfahren dunkler als eine ungeschattete Zeile mit Hover. Die Farbzuordnung und Farbmuster entsprechen der bestehenden BTP-Palette. Die Tönung betrifft die Zellhintergründe; Texte, Buttons, Anwesenheitsmarkierungen und der grüne Vorbereitungsrand behalten ihre eigene Gestaltung. Das Muster folgt beim Filtern den sichtbaren Zeilen.
- Ein gemeinsamer Drei-Punkte-Knopf ersetzt die drei Zeilenwerkzeuge. Er öffnet das ausgewählte Spiel direkt im Reiter „Bearbeiten“. „Schiedsrichterzettel“ und „Rohdaten“ stehen im selben Fenster; beim Reiterwechsel bleiben Formulareingaben erhalten. Der Zettel ist bei offenen Teilnehmern gesperrt und erklärt den Grund. Aufrufe und Ergebnisbestätigung bleiben direkt in der Tabelle. Ziehbare Spiele lassen sich an der Zeile ziehen; ein zusätzliches Drag-and-drop-Symbol entfällt samt seinem Platz in der Werkzeugspalte.
- Seitentitel und Aktionen an festen Stellen. Bereichswechsel behalten Turnier und Kontext. Die Suche findet Seiten und Funktionen.
- Alle Spieltabellen verwenden die Reihenfolge „Zeit · Disziplin · Runde“, einschließlich Feldübersicht, nicht zugewiesener und abgeschlossener Spiele sowie der Spieleansicht in der Sprachvorbereitung. Der Spiel-Dialog verwendet dieselbe Reihenfolge.
- Begegnungen stehen kompakt in einer Zeile: linke Paarung rechtsbündig, „v“ auf der festen Mittelachse, rechte Paarung linksbündig. Die „v“ aller Zeilen stehen dadurch exakt untereinander. In der Feldübersicht entfällt die redundante Statusbeschriftung vor den Spielernamen; die Aktionen am Zeilenende kennzeichnen den Zustand weiterhin.
- Alle Satzergebnisse stehen linksbündig und verwenden dieselbe Schriftgröße, Schriftstärke und Farbe, unabhängig von Satz und Spielstatus. Diese gemeinsame Größe und der Platz der Ergebnisspalte wachsen mit der tatsächlichen Breite des Turnierleitungsbereichs; eine ausgeklappte Seitennavigation wird dabei berücksichtigt. Jeder Satz hat feste Stellen für beide Punktzahlen und den Doppelpunkt. Dadurch stehen die Doppelpunkte des ersten, zweiten und dritten Satzes jeweils über alle Zeilen untereinander, auch bei einstelligen Ergebnissen. Tabellarische Ziffern halten die Abstände stabil.
- Informationsdichte passend zum Arbeitsablauf: Hauptseite kompakt, Formulare lesbar; Komfortmodus für größere Zeilen.
- Tastaturbedienbare Navigation, sichtbarer Fokus, Sprunglink zum Inhalt, benannte Symbolaktionen. Auf schmalen Ansichten bleiben Tabellen horizontal scrollbar.
- Gerätespezifische Audioschalter bleiben auf der Hauptseite. Betriebsstatus der Dienste erscheint im gemeinsamen Kopf.
- Warnungen gehören zur betroffenen Aufgabe; Fehlermeldungen sollen zu Details und Logs führen.
- Die Entwürfe verwenden Beispieldaten. Aus ihnen kann keine Aussage über den aktuellen Turnierbetrieb abgeleitet werden.

## Hallenfarben und BTP-Kompatibilität

Variante A ist vom Nutzer als Richtung ausgewählt. Die Highlightfarben kennzeichnen bereits die Vorbereitung für unterschiedliche Hallen und müssen mit BTP übereinstimmen. Der ursprüngliche Entwurf mit festen Zeilenfarben für Kandidaten und beendete Spiele ist deshalb ersetzt.

| BTP-Klasse | Farbe | Bestehender CSS-Wert |
| --- | --- | --- |
| highlight_0 | Keine Hervorhebung | #ffffff |
| highlight_1 | Gelb | #ffd838 |
| highlight_2 | Rosa | #ff79ab |
| highlight_3 | Orange | #fbad4b |
| highlight_4 | Blau | #1dace6 |
| highlight_5 | Türkis | #5ce1b8 |
| highlight_6 | Lila | #c56bff |

Quelle ist `static/css/cmatch.css`. `add_preparation_call_timestamp` in `bts/match_utils.js` übernimmt `location.highlight` in `setup.highlight`; der BTP-Abgleich überträgt dieses Highlight. Im Mockup sind Campus Hellweg mit Klasse 6 und Sporthalle Nord mit Klasse 4 ausdrücklich Beispieldaten. In Einstellungen → Felder & Spielorte lässt sich die Zuordnung für die Vorschau ändern; vorbereitete Spiele beider Ansichten folgen dieser Änderung. Bereits belegte Hallenfarben sind wie in den bestehenden Einstellungen nicht doppelt auswählbar.

Die zuvor gelben laufenden Beispielspiele sind korrigiert: Laufende Spiele ohne separaten Handlungsbedarf erscheinen neutral, ebenso beendete Spiele und Aufrufkandidaten ohne eigenes BTP-Highlight. Die Beispieldaten enthalten für diese Spiele Highlight 0. Gelb hebt stattdessen die freien Felder 4 und 13 hervor. Diese Hervorhebung ist eine Bedienhilfe und verändert keine BTP-Highlightwerte. Die Statussymbole und Texte funktionieren unabhängig von jeder der sechs Farben. Keine Hallenfarben oder Highlightregeln des laufenden BTS wurden geändert.

Die grüne Markierung für den Vorbereitungsbedarf entspricht fachlich `preparation_demand_court` aus der bestehenden Turnierleitung. Entscheidend sind die serverseitigen `demand_court_ids` je Halle: aktive freie Felder und laufende Spiele mit `needs_preparation_successor`. Der Nachfolgebedarf berücksichtigt die konfigurierte Anzahl weiterer Ballwechsel sowie Satzstand und Zählweise. Er ist vom aktuell noch ungedeckten Vorbereitungsbedarf zu unterscheiden; bereits vorbereitete Spiele nehmen die Markierung nicht automatisch weg.

Für die Mockup-Daten wurde die bestehende Berechnung aus `bts/match_automation.js` mit dem Standardwert von 11 Ballwechseln ausgeführt: Nachfolger für Feld 5 und 7 plus freie Felder 4 und 13 ergeben vier benötigte Vorbereitungsspiele in Campus Hellweg. Zwei sind dort bereits in Vorbereitung, zwei fehlen. Der Entwurf enthält diesen berechneten Snapshot; eine produktive Umsetzung übernimmt die vorhandenen Serverdaten und aktualisiert die Markierungen bei Regel- und Spielstandsänderungen. Die Vorschau liest keine laufenden Turnierdaten aus.

## Gemeinsame Navigation

| Hauptbereich | Ansichten und Aufgaben |
| --- | --- |
| Turnierleitung | Felder, Spielplan, Offizielle, Wartelisten, Ansagen, Automatik; zusätzliche Ansichten und Werkzeuge |
| Anmeldung | Meldungen, Anwesenheit, Kontrolle, Ranglisten und Import |
| Sprachsystem | Vorbereitung: Übersicht / Zustandsdiagramm / Spiele; Sprachhelfer; Hörlabor; Kontexteditor |
| Geräte & Logs | Geräte und offene Seiten; zentraler Neuladeauftrag; zentrale Logs und Diagnoseexport |
| Einstellungen | Allgemein; BTP; Turnierablauf; Spielorte & Felder; Sprache; Anzeigen; Wertung; Daten & Wartung |
| Testlabor | Testszenario; Steuerung; Turnieruhr; Leistungswerte; Berichte und Diagnose |

BUP-Zähltablets und öffentliche Anzeigen bleiben eigene, auf ihre Aufgabe zugeschnittene Ansichten. Sie müssen nicht die komplette Administrationsnavigation übernehmen. Die Turnierleitung verlinkt weiterhin auf diese Ansichten. Hörlabor und Kontexteditor sind im Entwurf gemeinsam erreichbar; ihre tatsächlichen Dienste und Berechtigungen müssen bei einer Umsetzung berücksichtigt werden.

## Funktionsabgleich

Der detaillierte [Abgleich mit der alten Turnierleitungsansicht](funktionsabgleich.md) ordnet Aktionen und Check-in jedem Spielzustand zu und nennt die zugehörigen Quellstellen. Die Hauptseiten-Mockups enthalten dazu konkrete Gegenbeispiele: einzelne fehlende Spieler, getrennte Rollenaufrufe, laufendes Spiel gegenüber ausstehender Ergebnisbestätigung, unbekannte Teilnehmer, BTP-Sperren und Tabletbindungen.

Die Liste verhindert, dass die spätere optische Umstellung Funktionen versehentlich entfernt. Im Mockup sind teils repräsentative Felder und simulierte Dialoge dargestellt; vollständige produktive Funktionsgleichheit muss erst bei der Implementierung geprüft werden.

| Bestehende Funktion | Ort im Entwurf | Bei Umsetzung zu erhalten |
| --- | --- | --- |
| Felder und Spiele | Turnierleitung, obere Tabelle | Alle Felder in korrekter Nummernreihenfolge; freie Felder mit sichtbarem Handlungsbedarf; neutrale laufende Spiele; Ergebnisse und Live-Updates |
| Nicht zugewiesene Spiele | Turnierleitung, zweite Tabelle | Ursprüngliche Spielreihenfolge, Vorbereitung, Sperrgründe, Anwesenheit und Aufrufgrenze |
| Beendete Spiele | Aufklappbarer Abschnitt unter dem Spielplan | Vollständige Liste und bisherige Detailaktionen |
| Spielaktionen | Gemeinsamer Spiel-Dialog und Aktionsspalte | Ein Zeilenknopf für Bearbeiten, Schiedsrichterzettel und Rohdaten; Protokoll erreichbar. Getrennte Team- und Rollenaufrufe je Zustand, Zuweisung, Abschluss erst nach vollständigem Ergebnis und neue Spiele; bestehende Editierfelder vollständig übernehmen |
| Tabletbediener | Kontrollbereich oben links | Suche, Hinzufügen, Entfernen, Reihenfolge und Herkunft; bestehende Zuordnungslogik |
| Technische Offizielle | Aufklappbarer Bereich neben der Warteliste; Spielbearbeitung | Schiedsrichter, Aufschlagrichter, Rotation und manuelle Zuordnung |
| Freie Ansagen | Kontrollbereich oben | Lokale und Remote-Ausgabe, Text und Wiedergabezustand |
| Evakuierung | Eigenständiger roter Button direkt beim Ansagefeld | Direkter Zugriff und bisherige Auslösung; kein zusätzlicher Bestätigungsdialog |
| Audio dieses Geräts | Gemeinsame Kachel „Auf diesem Gerät“ | Eine Tabellenzeile je konfiguriertem Spielort mit unabhängigen Häkchen für Feldanzeige, Spielaufrufe und Vorbereitungsaufrufe auf diesem Gerät; freie Remote-Durchsagen, Browser-/Serverstatus, Sprachtest und Wiedergabequeue darunter |
| Automatik | Kontrollbereich oben rechts | Globale Steuerung und vier Teilbereiche separat; aktuelle Betriebszustände eindeutig |
| Hallenfilter | Spalte „Felder“ in „Auf diesem Gerät“ | Alle konfigurierten Spielorte; Filter wirkt auf deren Feldzeilen und manuelle Vorbereitungsaufrufe, unabhängig von der lokalen Audioauswahl. Auswahl bleibt beim Seiten- und Dichtewechsel im Mockup erhalten |
| Weitere Ansichten | Button „Ansichten“ | Aktuelle/nächste Spiele, Selbstanmeldung, Anmeldung/Kontrolle, Anzeigen und Zähltablets |
| BTP/Ticker | Dienststatus, „Werkzeuge“, Einstellungen | Abgleich, Status, individuelle Konfiguration, ursprüngliche Reihenfolge beim Übertragen |
| Export/Urkunden | „Werkzeuge“ | Vorlagen, Siegerlisten, CSV, bestehende Optionen und Filter |
| Turnierdaten | Einstellungen → Allgemein | Alle Metadaten und Logo |
| Turnierablauf | Einstellungen → Turnierablauf | Vorbereitungszeiten, Bereitschaft, Tabletregeln und alle bisherigen Optionen |
| Wertung | Einstellungen → Wertung | Spielklassen, Runden und sämtliche vorhandenen Zählweisen |
| Spielorte/Felder | Einstellungen → Spielorte & Felder | Verwaltung aller Orte und Felder, Reihenfolge und Aktivierung |
| Anzeige/Werbung/Ticker | Einstellungen → Anzeigen | Templates, Werbung, Anzeigegeräte und Tickerparameter |
| Wartung | Einstellungen → Daten & Wartung | Sichern, Importieren, Datenbank löschen, Spielerpausen zurücksetzen, Felder nicht laufender Spiele lösen und an BTP übertragen |
| Debugschalter | Testlabor und passende Einstellungsgruppe | Alle vorhandenen Featureflags und Testuhrfunktionen; keine unbemerkten Standardänderungen |
| Sprachvorbereitung | Sprachsystem → Vorbereitung | Alle Prioritäten, Disziplinphasen, parallele Generatoren, echte Queue und Begründungen |
| Sprachspiele | Vorbereitung → Spiele | Normale Reihenfolge; Statusfilter inklusive „noch nicht beendet“; einzelne Durchsagen und Bausteine |
| Sprachhelfer | Sprachsystem → Sprachhelfer | Echte Aufträge, aktuelle Arbeit, Pause/Trennen, Test, Downloads; Ressourcenentscheidung bleibt am Helferrechner |
| Hörlabor/Kontexteditor | Sprachsystem | Bestehende Sprachserverfunktionen, vollständige Kontextaufnahmen und Ausschnittbearbeitung |
| Logs/Geräte | Geräte & Logs | Server, Adminseiten und Clients; Quellenfilter, Diagnose; zielgerichtetes Neuladen mit vorhandenen Schutzmechanismen |
| Leistungstests | Testlabor | Bestehende Szenarien und Metriken, Berichte und Systemzustände |
| Anmeldung/Ranglisten | Anmeldung | Punktesortierung, Summen, fehlende Spieler mit 0 Punkten, U19/O19-Zuordnungen, individuelle Importoptionen |

## Umfang der Vorschau

Zwölf Ansichten plus acht Einstellungsgruppen, in beiden Navigationsvarianten erreichbar. Interaktiv sind unter anderem Navigation, Variantentausch, Dichte/Fokusmodus, Spiel- und Wartungsdialoge, Suchfelder, Statusfilter, Warteliste, Teilautomatik, Drag-and-drop-Vorschau, Helferpause, Logfilter und Auswahlaktionen in der Anmeldung.

Vollständige nicht zugewiesene Spiele sind in der Vorschau ziehbar, auch vor der Vorbereitung. Die zuvor künstlich eingeführte Beschränkung auf vorbereitete Spiele derselben Halle ist nach dem Quellenabgleich entfernt. Freie Felder sind manuelle Ablageziele; belegte Felder und bekannte BTP-Sperren werden nicht als gültige Ziele beziehungsweise Quellen angeboten. Dieser manuelle Weg ist von der automatischen Eignung zu unterscheiden. Ablegen öffnet nur den simulierten Zuweisungsdialog mit vorausgewähltem Spiel und Feld. „Zuweisen“ bleibt als Alternative per Tastatur und ohne Ziehen erreichbar. Daraus folgt keine zusätzliche Bestätigungspflicht für den bisherigen produktiven Drag-and-drop-Ablauf.

Repräsentative Daten bleiben absichtlich konstant. Ein Hauptseiten-Filter oder eine Demo-Aktion darf in diesen Entwürfen noch die HTML-Darstellung neu aufbauen; dies ist kein Vorschlag für die produktive Live-Datenverarbeitung. Bei einer Umsetzung müssen bestehende inkrementelle Aktualisierungen erhalten bleiben.

## Turnierbetrieb auf Full HD

Der Entwurf wurde nach dem Vergleich mit der alten Turnierleitung auf nutzbare Fensterhöhe ausgelegt. Im Standardmodus „Kompakt“ sind bei 1.920 × 940 CSS-Pixeln alle 13 Feldzeilen und die ersten beiden vorbereiteten Spiele gleichzeitig sichtbar. Die 940 Pixel lassen auf einem Full-HD-Bildschirm Platz für Browserleisten und Taskleiste; die Prüfung verwendet keinen vergrößerten Screenshot mit zusätzlicher Höhe.

- Die Kopfzeile nennt „BTS – Seitenname“, gefolgt vom Turniernamen. Ab 1.450 Pixeln Breite stehen Navigation, Turnier und Dienststatus in einer 44 Pixel hohen gemeinsamen Leiste. Alle sechs Bereiche bleiben direkt erreichbar. In der Turnierleitung entfällt die separate Titelzeile; Ansichten, Werkzeuge und Dichteauswahl stehen rechts neben der Suche anstelle der entfernten Statuslegende. Die Feldanzahl bleibt bei den Belegungszahlen sichtbar. Eine für Screenreader zugängliche Hauptüberschrift bleibt erhalten.
- Bedienkarten und Abstände sind niedriger. Freie Durchsagen, Evakuierung, Audioauswahl, Warteliste und Automatik bleiben offen bedienbar. Die Tabletwarteliste scrollt innerhalb ihrer begrenzten Höhe, statt die ganze Ansicht nach unten zu schieben. Der Komfortmodus bietet weiterhin höhere Spielzeilen.
- Feldzeilen sind im Kompaktmodus etwa 30 Pixel hoch. Spielstände bleiben groß, gleich formatiert und am Doppelpunkt ausgerichtet; Spiel-Timer stehen linksbündig direkt hinter dem letzten angezeigten Satzergebnis, mit zehn Pixeln Abstand. Spiel- und Vorbereitungstimer verwenden die vorhandene Siebensegmentschrift aus `static/css/seg7.ttf`. Spiel-Timer haben weiße Ziffern und ein weißes Uhrsymbol auf schwarzem Hintergrund; Vorbereitungstimer greifen die Hallenfarbe auf. Die Zeit zeigt mindestens `0:00`; auch reine Sekundenwerte werden als Minuten und zweistellige Sekunden dargestellt. Die Bedeutung wie Satzpause oder Zeit seit Feldaufruf bleibt als Tooltip und zugängliche Beschriftung erhalten. Spielernamen sind gegenüber der vorherigen Vorschau größer.
- Erklärungen, Farblegende und Vorbereitungsdetails liegen in einem aufklappbaren Hinweisbereich. Zwischen Feldtabelle und vorbereiteten Spielen stehen dadurch keine dauerhaften Informationsblöcke.
- Vollständige nicht zugewiesene Spiele lassen sich an der Zeile ziehen. Aufruf- und Check-in-Knöpfe bleiben eigenständige Klickziele.
- Beim Ziehen erscheint unter der festen Navigation eine zusätzliche Leiste mit den aktuell sichtbaren freien Feldern und deren Spielort. Sie bleibt beim Scrollen erreichbar und verwendet dieselbe Zuweisung wie die Feldzeilen. Sie nimmt keinen Platz im Dokumentfluss ein und verschiebt die Spielquelle nicht.
- Ablegen funktioniert auf der ursprünglichen Feldzeile und auf der zusätzlichen Leiste. Nach Ablegen, Abbrechen, Escape oder Seitenwechsel verschwinden Leiste und Markierungen. Bekannte BTP-Sperren erzeugen keine gültigen Ablageziele.

Die zusätzlichen Bilder `previews/a-leitstand-full-hd.png` und `previews/a-leitstand-ziehen-gescrollt.png` zeigen die nutzbare Fensterfläche beziehungsweise das Ziehen aus einer weiter unten stehenden Spielzeile. Bei einer produktiven Umsetzung muss die Feldverfügbarkeit auch bei parallelen Live-Änderungen erneut geprüft werden; die Vorschau verwendet feste Beispieldaten.

## Kacheln anordnen und rechte Sidebar

„Layout anpassen“ in der Werkzeugleiste öffnet einen eigenen Bearbeitungsmodus. Die vier Kacheln lassen sich an Titel, freier Kachelfläche oder eingeblendetem Griff innerhalb der oberen Reihe und der rechten Sidebar sortieren oder zwischen beiden Bereichen verschieben. Beim Ablegen auf der Mitte einer anderen Kachel tauschen beide ihre genauen Positionen, auch zwischen den Bereichen; alle übrigen Kacheln bleiben an ihrer Stelle. Die Zielkachel zeigt dafür „Positionen tauschen“. Am Rand wird stattdessen davor oder dahinter einsortiert, auf freier Bereichsfläche am Ende angefügt. Ablageflächen und eine Einfügekante zeigen das Ziel. Eingabefelder, Links und Knöpfe lösen beim Bedienen keinen Kachel-Drag aus. Außerhalb dieses Modus bleiben die Kacheln ohne Ziehgriffe; das Ziehen von Spielen auf freie Felder behält seine bisherige Funktion.

Pfeilknöpfe ändern die Reihenfolge ohne Ziehen, „Sidebar“ beziehungsweise „Oben“ wechseln den Bereich. Diese Knöpfe sind auch per Tastatur und auf Touch-Geräten bedienbar. Beim Verschieben bleiben dieselben Kachelelemente erhalten, einschließlich eingegebener Durchsagen, Suche, aufgeklappter Inhalte und geschalteter Bedienelemente.

„Fertig“ speichert die Anordnung für diesen Browser unter `bts-admin-mockup-card-layout-v1`; sie gilt für beide Entwurfsvarianten und bleibt nach Neuladen erhalten. „Abbrechen“ stellt die Anordnung vor dem Bearbeiten wieder her, „Standard“ setzt den Entwurf innerhalb des Bearbeitungsmodus zurück. Die Speicherung betrifft nur das Layout. Ist der Browserspeicher nicht verfügbar, bleibt die Anordnung für die laufende Sitzung nutzbar und die Rückmeldung nennt diese Einschränkung.

Die rechte Sidebar ist optional und bleibt beim Scrollen unter der Navigation erreichbar. Ohne seitliche Kacheln nutzen die Spiele die volle Breite. Spielstände passen sich an die tatsächlich verbleibende Tabellenbreite an. Bei weniger als 1.450 Pixeln verfügbarer Inhaltsbreite stehen die seitlichen Kacheln zwischen der oberen Kachelreihe und den Spielen, damit die Tabellen nutzbar bleiben. Die gespeicherte Zuordnung wird dadurch nicht verändert.

## Vorgehen nach Auswahl

1. Bestehende Funktionen und Spezialfälle gegen die obige Liste ergänzen. Neue gemeinsame Gestaltung als CSS-Tokens und kleine wiederverwendbare Komponenten definieren.
2. Navigation und Rahmen zuerst für Einstellungen, Sprache, Diagnose und Tests übernehmen, jeweils mit bisherigen Aktionen und Datenverbindungen.
3. Die Hauptseite schrittweise übertragen: zunächst Typografie, Abstände und die bestehende BTP-Highlightdarstellung mit getrennten Statusbeschriftungen, dann Kontrollbereiche und Tabellen. Bestehende Ereignishandler, serverseitige Regeln und inkrementelle Zeilenaktualisierungen weiterverwenden.
4. Je Schritt Bedienabläufe, mehrere parallele Adminfenster, BTP-Reihenfolge, Tabletbediener, Ansagen und Automatik prüfen. Performance mit vorhandenen Benchmarks vergleichen.
5. Dichte/Fokusmodus als Benutzerpräferenz speichern. Vor breitem Einsatz im realen Turnierbetrieb testen.

Für die ursprünglichen Mockups wurden die Dateien der produktiven Oberfläche nicht geändert. Die anschließend beauftragte Umsetzung der Turnierleitung ist separat unter [Umsetzung](umsetzung/README.md) dokumentiert; die übrigen Seitenentwürfe bleiben Mockups.

## Prüfung der Mockups

Mit Headless Chrome geprüft: 80 Seitenaufrufe über beide Varianten und Bildschirmbreiten von 390, 1.450, 1.536, 1.600, 1.920 und 2.560 Pixeln sowie 101 Bedienprüfungen. Zusätzlich wurde bei 1.920 × 940 Pixeln mit echten Maus- und nativen Drag-Ereignissen vom sichtbaren Spiel auf eine Feldzeile sowie vom heruntergescrollten Spiel auf die feste Feldleiste gezogen. Bei 1.536 × 750 Pixeln wurden die erreichbaren Ziele mit kleinerer nutzbarer Fläche geprüft, vergleichbar mit 125 Prozent Zoom auf Full HD. Keine JavaScript-Ausnahmen, fehlgeschlagenen Asset-Anfragen oder über den Seitenrand laufenden Layouts in den geprüften Ansichten. Breite Tabellen bleiben innerhalb ihres eigenen Bereichs scrollbar. Direkter Start als lokale HTML-Datei ohne Server wurde ebenfalls geprüft, einschließlich des Ladens der Siebensegmentschrift.

Der gemeinsame Spiel-Dialog ist zusätzlich in `previews/a-spieldialog.png`, `previews/a-spieldialog-rohdaten.png` und `previews/a-spieldialog-mobil.png` abgebildet. Reiterwechsel, erhaltene Formulareingaben, gesperrte Zettel bei offenen Teams, Tastaturbedienung und die Rückgabe des Fokus an die Spielzeile wurden geprüft.

Die Rollenknöpfe für Schiedsrichter und Aufschlagrichter wurden auf unterschiedliche Symbole ohne Buchstabenkürzel, Rollenbeschriftung und Fokus im passenden Zuweisungsfeld geprüft. Die Namensmarkierungen beginnen auf derselben linken Kante. Tablet-Paarungen zeigen „Name / Name“ bei genügend Platz in einer Zeile und brechen sonst zwischen den Personen um; der Schrägstrich bleibt beim ersten Namen. Bei der Tablet-Paarung wurden gemeinsamer Check-in per Klick auf den zweiten Namen, gemeinsames Auschecken per Tastatur, Fokus nach der Aktualisierung und die passende Feldaufruf-Diagnose geprüft. Einzeln zugewiesene Tabletbediener und andere Rollen bleiben dabei getrennt bedienbar.

Die zusätzliche Vorschau `previews/a-leitstand-hover.png` zeigt den Hover-Effekt auf einer bereits schattierten blauen Zeile. Mit echten Mausbewegungen wurde geprüft, dass neutrale, farbige und gelbe Zeilen zusätzlich dunkler werden und das Streifenmuster beim Hover erhalten bleibt. Tastaturfokus verwendet dieselbe zusätzliche Schattierung.

Die Aufrufstatus-Vorschauen `previews/a-aufrufstatus.png` und `previews/a-aufrufstatus-details.png` zeigen die rechte Statuskante und den Informationsdialog. Geprüft wurden die Trennung von Vorbereitungs- und Feldaufruf, unverändert verfügbare manuelle Vorbereitungsaufrufe, Statuswechsel nach Personen- und Rollen-Check-in sowie Tastaturbedienung mit Rückgabe des Fokus. Das Info-Icon bleibt im Ruhezustand transparent und erhält nur bei Hover oder Tastaturfokus einen hellen Hintergrund.

Die Anwesenheitsmarkierungen wurden zusätzlich mit simulierten Formen von Rot-Grün-Sehschwäche geprüft: `previews/a-anwesenheit-deuteranopie.png` und `previews/a-anwesenheit-protanopie.png`. Der berechnete Textkontrast beträgt für „Anwesend“ 7,89:1. Check-in und Auschecken wechseln Hintergrund und zugängliche Beschriftung gemeinsam. Die Simulation ergänzt die visuelle Prüfung; persönliche Wahrnehmung kann davon abweichen.

Die Kachelanordnung wurde zusätzlich mit 27 Prüfungen und 15 Seitenaufrufen in beiden Varianten bei 390, 1.536, 1.600 und 1.920 Pixeln Breite geprüft. Dazu gehören echte native Drag-Ereignisse in beiden Kachelbereichen, das Ziehen am Titel und an freier Kachelfläche, genaue Positionstausche innerhalb einer Reihe und zwischen beiden Bereichen, geschützte Eingabefelder, Tastaturbedienung, erhaltene Eingaben, Abbrechen, Standardanordnung, Speichern und Wiederherstellen nach einem echten Neuladen, ungültige gespeicherte Einträge, eine beim Scrollen erreichbare Sidebar und das weiterhin funktionierende Ziehen von Spielen auf Felder. Keine JavaScript-Ausnahmen, fehlgeschlagenen Asset-Anfragen oder Seitenüberläufe. Bei 1.920 × 940 Pixeln bleiben auch mit Sidebar die Tabellen ohne horizontalen Überlauf. Die zusätzlichen Bilder `previews/a-leitstand-sidebar.png`, `previews/a-leitstand-layout-anpassen.png` und `previews/a-leitstand-kacheln-tauschen.png` zeigen die Anordnung, den Bearbeitungsmodus und ein Tauschziel; der ergänzende Prüfbericht steht in `static/mockups/admin/layout-verification.json`.

39 Vorschaubilder liegen unter `static/mockups/admin/previews/`. Der ursprüngliche Prüfbericht steht in `static/mockups/admin/verification.json`. Die Prüfung betrifft die Mockups und ihre simulierte Bedienung; sie ersetzt keine Funktionsprüfung einer späteren produktiven Migration.
