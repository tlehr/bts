# Gemeinsamer Aufrufstatus

`index.js` hält pro BTS-App und Turnier die Auswahl, Aufrufdiagnosen und manuellen
Aufrufmöglichkeiten der Spielorte im RAM. Automatische Vorbereitungsaufrufe und
`preparation_selection_get` benutzen diesen Dienst. Die Oberfläche übernimmt
die Entscheidungen; die bisherige lokale Berechnung bleibt für ältere Antworten
ohne `manual_callable_match_ids` erhalten.

`inputs.js` vergleicht unveränderliche Datenrevisionen. Neue oder entfernte
Spiele, Teilnehmer, Check-ins, Ergebnisse, Spielfelder, Offizielle,
Tabletbediener und Einstellungen machen den Stand ungültig. Normale Punkte,
Aufschlag, Historien und reine Sync-Quittungen tun das nicht. Ein durch Punkte
geänderter `setup.needs_preparation_successor` ist dagegen relevant. Historien
werden weder gelesen noch kopiert, um eine Revision zu vergleichen.

Die Invalidierung ist bewusst konservativ: Ein relevantes Ereignis verwirft
die gemeinsame Turnierauswahl. Einzelne Spielorte können durch Teilnehmer,
Abhängigkeiten und Aufrufgrenzen miteinander verbunden sein. Eine feinere
Invalidierung pro Spiel ist noch nicht enthalten.

`deadlines.js` ermittelt die nächste absolute Regelgrenze: Vorbereitungsdauer,
Startfenster, Spieler- oder Tablet-Pause. Es gibt keinen 250-ms-Ablauf mehr.
Ohne Änderung gilt ein Ergebnis bis zu dieser Grenze; ohne weitere Grenze
bis zum nächsten Ereignis. Uhränderungen und Rücksprünge werden berücksichtigt.
Zeitangaben in den Diagnosen nennen absolute Freigabezeiten, damit ein alter
relativer Wert wie „noch 2 Minuten“ nicht im gültigen Status stehen bleibt.

Angemeldete Adminseiten erhalten `call_status_changed` mit derselben Auswahl
und einer Serverkennung/Revision wie die Abfrageantwort. Ein Timer pro
beobachtetem Turnier weckt den Dienst an der nächsten Zeitgrenze. Eine fixierte
Testuhr erzeugt keinen Timer. Der letzte Socket-Abgang und das Serverende lösen
die Timer auf. Vorübergehende Berechnungsfehler werden mit Ursache geloggt und
für weiter beobachtete Turniere nach einer Sekunde erneut versucht.

Jede Abfrage quert weiterhin die geordneten Leseschranken aller sechs
Eingabekollektionen. Modellereignisse entstehen bereits beim Indexwechsel;
erst nach abgeschlossenen Schreibvorgängen darf ein Ergebnis veröffentlicht
werden. Änderungen während einer Berechnung verwerfen deren Ergebnis.
Kooperative Rechenschritte räumen Punkten und Sync-Commits Vorrang ein. Ein
Vorrangbesitzer wartet nicht auf eine Hintergrundberechnung, die auf dessen
Freigabe wartet. Ein älteres Hintergrundresultat ersetzt keinen inzwischen
berechneten neueren Stand.

Die öffentliche Antwort ist unveränderlich, ihre Kodierung wird zwischen
Adminfenstern geteilt. Öffentliche Auswahlhelfer liefern weiterhin getrennte
veränderliche Kopien; die interne Automatik liest unveränderliche Referenzen.
Nicht mehr beobachtete Turniere können ab 32 Einträgen verdrängt werden.

Die Oberfläche vergleicht zusätzlich den tatsächlichen Inhalt einer neueren
Revision mit dem zuletzt übernommenen Stand. Gleicher Inhalt verursacht keine
Status-DOM-Arbeit; Serverkennung, Revision und Gültigkeit werden trotzdem
fortgeschrieben. Bei Änderungen werden die betroffenen Spiel-IDs aus manuellen
Freigaben, Diagnosen und Aufrufgrenzen bestimmt. Die Zeilen werden über den
bestehenden DOM-Index angesprochen. Feldmarkierungen und Grenzzeilen haben
getrennte Änderungen. Mehrere Aktualisierungen vor einem UI-Durchlauf vereinigen
ihre Spiel-IDs; ein notwendiger vollständiger Durchlauf bleibt erhalten.
Geöffnete Statusdialoge prüfen nur Änderungen ihres eigenen Spiels. Beim ersten
Stand, neuen Spielorten und älteren Antworten ohne vollständige Freigabeliste
bleibt der vollständige Abgleich erforderlich.

Neue Adminseiten melden bei `preparation_selection_get` zusätzlich
`call_status_delta: true` an. Die erste Antwort enthält weiterhin den vollständigen
Stand und bestätigt mit `call_status_subscribed`, dass spätere Änderungen aktiv
zugestellt werden. Solange diese Anmeldung gilt, lösen Punkte und andere
gewöhnliche Ereignisse keine zusätzliche Vollabfrage aus. Ein Verbindungsabbruch
verwirft die Anmeldung und beendet zugehörige wartende UI-Aufgaben.

`admin_response/call_status.js` führt je Socket den zuletzt ausgelieferten Stand.
Weitere Revisionen enthalten `selections_delta` mit Ausgangsrevision, geänderten
Spielortfeldern und geänderten oder entfernten Diagnosen pro Spiel. Unveränderte
Diagnosen teilen ihre unveränderlichen Referenzen zwischen Revisionen. Ihre
Vergleiche laufen kooperativ, damit die Aufbereitung Punkte nicht lange blockiert.
Sockets ohne Statusanmeldung erhalten keine solchen Hintergrundmeldungen;
angemeldete ältere Clients erhalten weiterhin vollständige Antworten.

`static/js/call_status_updates.js` übernimmt Patches atomar. Serverkennung und
Ausgangsrevision müssen zum lokalen Stand passen. Bei einer Lücke fordert die
Seite einen neuen vollständigen Ausgangsstand an. Unveränderte Spielorte und
Diagnosen behalten ihre Referenzen auch im Browser. Eine wiederholte identische
Revision wird nicht erneut zugestellt; gleiche Inhalte einer neueren Revision
ändern nur die Statusmetadaten.

Die tatsächliche Ausführung behält ihre frische Prüfung mit Ressourcensperren.
Die Feldvergabe verwendet weiterhin den validierten Planer und dessen
`auto_call_precheck`; sie überspringt keine Abschlussprüfung aufgrund des
gespeicherten Anzeigestatus. Prüfungen mit abweichenden Regeloptionen verwenden
ebenfalls die vorhandene direkte Berechnung.

Gezielte Prüfungen: `test/test_call_status.js`,
`test/test_preparation_admin_reads.js`, `test/test_preparation_selection_reads.js`
und `browser-check.js --shared-call-status-only` unter
`docs/entwuerfe/admin-ui/umsetzung/`.
