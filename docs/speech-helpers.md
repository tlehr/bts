# Sprachhelfer für Windows und Linux

In **Turniereinstellungen → Aufrufe → Sprachhelfer auf weiteren Rechnern** lassen sich persönliche Windows- und Linux-Starter herunterladen. Die Seite
liegt unter `/admin/t/<Turnier>/speech-helpers/` und zeigt verbundene Rechner,
deren Aufträge und abspielbare Testaufnahmen. Sie wird alle zwei Sekunden
aktualisiert. Nach Installation der Änderungen BTS neu starten und die
Einstellungsseite neu laden.

Freie, passende Helfer erhalten jetzt automatisch vollständige Kontextaufnahmen
für die reguläre Sprachvorbereitung. Jeder Helfer bearbeitet einen Auftrag;
mehrere Helfer und der bisherige Sprachserver können gleichzeitig synthetisieren.
Der Sprachserver bleibt für Qualitätsprüfung, Alignment, Ausschnitt und
Wiedergabeaufbereitung erforderlich. Die fertigen Bausteine gelangen durch die
bestehende geschützte API in den BTS-Dateicache. Testaufnahmen bleiben getrennt.

Zum Aktivieren **BTS und Sprachserver selbst neu starten**, die Seite neu laden
und einen **neuen Starter herunterladen**. Das neue Laufzeitpaket verwendet
auch die aktuell ausgewählten V2-Stimmprofile. Ein alter Helfer aktualisiert
sich nicht selbst. Die neue Paketversion benötigt erneut etwa 2 GiB Download;
der Nutzer startet sie nach den angezeigten Informationen ausdrücklich.

## Reguläre Aufträge und Ausfälle

BTS reserviert eine Quelle beim Sprachserver und übergibt dem Helfer den exakten
Text einschließlich Zahlenausschreibung, Stimme und Seed. Der Helfer sieht
somit auch Spielernamen. API-Schlüssel und Turnierdatenbanken bleiben auf BTS.
Ein Hash bindet Modelle, native Bibliotheken, beide Stimmprofile und Sampling.
Die CPU-Wahl des Hosts ist eine ausdrücklich eigene Cachefamilie; sie wird
nicht als identisch zur Threadzahl des Sprachservers ausgegeben. Das tatsächlich
verwendete CPU-Budget wird pro Ergebnis gespeichert.

Derzeit werden deutsche Quellen bis 380 Zeichen und höchstens der am Server
eingestellten Chunkgrenze verteilt. Längere Quellen, fertige Hörpaketquellen,
Ausschnitte und Aufbereitung bleiben auf dem Server. Fehlt ein passender Helfer
oder schlägt dessen Auftrag fehl, übernimmt der normale Serverweg. Das kleine
Ergebnislager ist auf höchstens zwei offene Aufträge je verbundenem Helfer
(maximal 32) begrenzt. Die zentrale CPU führt weiterhin nur einen Auftrag aus;
weitere fertige Helferaufnahmen warten auf diesen Platz. Rohaufnahmen werden
nach bestätigter Übernahme oder Aufgabe aus dem Zwischenlager entfernt.

Die bestehenden V2-Prüfungen und begrenzten Versuche gelten auch für fremd
erzeugtes Audio. Bei Ablehnung kann der Sprachserver den nächsten Seed lokal
versuchen. Erst eine bestätigte zentrale Veröffentlichung und der BTS-Dateicache
bedeuten **Bereit**. Die Helferseite zeigt bis dahin **Wartet auf zentrale
Prüfung**; die lokale Abschlussmeldung bestätigt nur die Übertragung an BTS.

90-Sekunden-Leases werden erneuert. Abgebrochene/abgelaufene Versuche können
an andere Helfer gehen; veraltete Rückgaben dürfen keine neuen ersetzen. Ein
kurzer Ausfall des Sprachservers behält vorhandene Arbeit. Nach einem Neustart
des BTS-Sprachprozesses werden gespeicherte Aufträge wieder zugeordnet, soweit
sie noch zum Plan und zur Identität passen. Bei geändertem Plan oder verlorener
Serverreservierung wird die alte Zuweisung verworfen und bei Bedarf lokal
neu geplant. **Pause**, **Stoppen**, Ressourcenwahl und **Entfernen** bleiben
unter Kontrolle des Nutzers auf dem jeweiligen Rechner.

## Prüfung der regulären Verteilung

Der isolierte native Lauf vom 25.10.2026 verwendete das ausgelieferte Paket,
einen echten CPU-Helfer mit zwei Kernen/3584 MiB, einen privaten Sprachserver
und einen privaten BTS-Dateicache. Die 7,12-Sekunden-Kontextaufnahme bestand
die zentrale V2-Prüfung mit Seed 42. Daraus entstanden der gewünschte Ausschnitt,
die Wiedergabeaufbereitung und ein bestätigter Cacheeintrag. Synthese einschließlich
Modellstart: 35,1 Sekunden; bis zum fertigen Baustein: 44,2 Sekunden. Das ist
ein Funktionsnachweis, keine Vergleichsmessung zwischen Rechnern.

Der Lauf verwendete zufällige lokale Ports, künstliche Texte und eigene temporäre
Daten. Produktive Dienste, BTP und Turnierdaten wurden nicht benutzt.
[Prüfergebnis](../debug/speech_helpers_production_2026-10-25.json).
Zusätzlich bestanden 116 Node-Prüfungen, 56 Sprachserver-/Agentenprüfungen,
12 Linux-Starterprüfungen, zwei echte Chrome-Prüfungen und der PowerShell-
Starterprüflauf. Der neue native Ablauf ist unter Linux geprüft; ein neuer
praktischer Windows-GUI-Lauf bleibt auf dem Windows-Rechner zu prüfen.

Reproduktion auf dem Entwicklungsrechner mit vorhandenem privatem Laufzeitpaket:

```sh
node debug/speech_helper_generation_probe.js /Pfad/zum/Laufzeitpaket
```

## Parallele Aufträge in der Sprachvorbereitung

Auch die Vorratsvorbereitung vor der ersten Auslosung versorgt jeden freien
Generator mit einem unabhängigen Auftrag. Bereits zugewiesene Quellen blockieren
die Freigabe der nächsten passenden Quelle nicht. Mehrere Ausschnitte derselben
Quelle erzeugen keine doppelte Synthese; wartende Ausschnitte bleiben für den
Sprachserver vorgemerkt. Die Freigabe erfolgt nach Bedarf je freiem Generator,
ohne den vollständigen Vorrat in die Queue einzureihen. Ausgelöste Aufrufe,
benötigte Bausteine und die ausgewählte Stimme behalten ihren Vorrang.
Geprüft mit einem Sprachserver plus einem beziehungsweise drei Helfern;
der laufende BTS bestätigte zusätzlich parallele Arbeit von Sprachserver
und TIM-THINKPAD.

Eine Planaktualisierung pausiert neue Vorratsaufträge. Bereits in die begrenzte
Queue aufgenommene Aufträge laufen weiter, auch wenn sie auf einen Ausschnitt
aus einer inzwischen fertigen Quelle warten. Echte Aufrufe und benötigte
Bausteine behalten Vorrang. Wiederholte Vorbereitungsanfragen für bereits
vorhandene Aufnahmen lösen keine zusätzliche Neuplanung aus. Die Queue
unterscheidet „Wartet auf Quellaufnahme“ von „Wartet auf Aufbereitung“; wartet
die Freigabe neuen Vorrats auf die Planung, zeigt die Übersicht dies ausdrücklich.
Das Öffnen weiterer Adminseiten mit unveränderten Turnierdaten markiert einen
vorhandenen Sprachplan nicht erneut als ungültig und verwirft keinen laufenden
Planaufbau. Echte Änderungen, geänderte Spracheinstellungen und neue offene
Sprachaufträge lösen weiterhin einen Abgleich aus. Die Planungsauskunft enthält
zusätzlich die aktuelle Aktualisierungsphase und ob neuere Änderungen vorliegen.


Die konkrete Queue zählt laufende Aufträge auf Sprachserver und Helfern gemeinsam
und nennt den ausführenden Rechner. Noch nicht angenommene Helferaufträge sowie
fertige Aufnahmen, die auf die zentrale Prüfung warten, zählen als wartend.
Die zentrale Prüfung wird erst bei tatsächlicher Bearbeitung als laufend gezeigt.
Der Plan erkennt auch dann laufende Arbeit, wenn nur ein Helfer für das Turnier
arbeitet und der Sprachserver ein anderes Turnier bearbeitet.

Normales Warten auf den belegten Server zeigt keinen Fehler-Wiederholungszeitpunkt.
Der interne Rückstau-Timer bleibt wirksam, wird aber nicht auf alle Queuezeilen
übertragen. Echte Fehler behalten ihren Wiederholungshinweis. Nach einer
bestätigten Audioübernahme wird die zentrale Bearbeitung nur noch abgefragt;
der Helfer-WAV wird währenddessen nicht erneut hochgeladen.

## Sichtbarer Auftrag auf dem Helfer

Das Windows-Fenster zeigt außerhalb der Detailreiter einen eigenen Bereich
**Aktueller Auftrag**: den vollständigen gesprochenen Text, die Stimme,
eine kurze Auftragskennung und die verstrichene Laufzeit. Der Status
unterscheidet Erzeugen, Übertragen, bestätigten Abschluss, Fehler, Abbruch,
Warten und Pause. Ein neuer Auftrag ersetzt die vorherigen Angaben und
startet seine eigene Uhr. Während Warten oder Pause bleibt der letzte Text
mit seinem Ergebnis sichtbar. Stoppen und Verbindungs-/Prozessfehler dürfen
keine weiterhin laufende Generierung vortäuschen.

Unter Linux stehen Text, Stimme, Auftragskennung und die Bearbeitungsschritte
direkt im Terminal. Es gibt keine geschätzte Prozentanzeige für die Synthese.
Erst eine erfolgreiche BTS-Antwort auf die Audioübertragung bedeutet
lokal „abgeschlossen“; die zentrale Qualitätsprüfung kann noch ausstehen. Windows erhält über `--events` strukturierte lokale Meldungen;
sie enthalten ausschließlich Phase, Kennung, Text und Stimme, keine Kopplungs-,
Sitzungs- oder Zuweisungsschlüssel. Die Anzeige erzeugt keine zusätzlichen
HTTP-Abfragen an BTS.

Für diese Anzeige wurden Starter und Helferlaufzeit aktualisiert. Bereits
heruntergeladene Starter aktualisieren sich nicht selbst: alten Helfer stoppen,
neuen Starter aus BTS herunterladen und starten. Die geänderte Laufzeitversion
benötigt erneut den etwa 2-GiB-Download und eine eigene neue lokale Laufzeit;
alte Versionen können über **Helfer entfernen** entfernt werden. Es erfolgt
keine automatische Änderung eines laufenden Helfers.

## Auf dem Windows-Rechner

1. Die BTS-Seite über die vom Windows-Rechner erreichbare Netzwerkadresse
   öffnen. Die vorbelegte Helferadresse zeigt auf den separaten Audioanschluss,
   normalerweise HTTPS-Port **4434**. `localhost` bezeichnet auf Windows den
   Windows-Rechner und wird beim Erstellen des Pakets abgelehnt. Firewall und
   Portfreigabe müssen den direkten Anschluss erlauben.
2. **Windows-EXE herunterladen** und die einzelne Datei öffnen. Daneben sind
   keine ZIP oder Begleitdateien nötig. Es sind Windows 11 x64, eine CPU mit
   AVX2/FMA/BMI2 erforderlich. Das Fenster erklärt Änderungen, Speicherbedarf,
   Datenaustausch, Abbruch und Entfernung. Es beginnt erst nach **Starten**.
   CPU-Kerne und Modell-RAM-Abbruchgrenze werden vorher vom Nutzer gewählt.
   Eine lokale Messung schlägt Werte vor, die nur mit **Vorschlag übernehmen**
   eingetragen werden. Die Einrichtung startet dadurch noch nicht.
3. Nach dem Start prüft der Starter WSL selbst. Fehlt es, bietet er die Einrichtung mit
   Windows-UAC an. Ein erforderlicher Neustart wird nicht automatisch ausgelöst;
   vorher BTP speichern und regulär beenden. Nach abgeschlossener Einrichtung
   wird WSL erneut geprüft und bei Bereitschaft direkt weitergemacht. Bei
   notwendigem Neustart bzw. noch ausstehender Einrichtung zeigt das Fenster
   einen passenden Hinweis und **Erneut prüfen**. Nach einem Windows-Neustart
   die EXE erneut öffnen.
4. Der Starter lädt die vorbereitete Laufzeit einschließlich Modelle einmalig
   vom BTS, prüft SHA-256 und importiert eine eigene WSL-2-Distribution.
   Der erste Download umfasst derzeit rund **2,0 GiB**; Download und importierte
   Laufzeit benötigen zusammen zusätzlichen Plattenplatz. Abgebrochene Downloads
   werden mit Prozent, Datenmenge und Geschwindigkeit angezeigt und bei einem
   späteren Start fortgesetzt. Prüfen und Einrichten zeigen eine Aktivitätsanzeige.
   Docker Desktop, Python und Compiler werden auf Windows
   nicht benötigt.
5. Das Fenster offen lassen. Sobald der Rechner in BTS erscheint, automatisch Aufträge übernehmen lassen. Optional über
   **Testaufnahme** eine Aufnahme anfordern und danach auf der Seite anhören.
   Beide Stimmen können getrennt geprüft werden. **Pause** lässt den aktuellen
   Auftrag fertig werden; **Trennen** entzieht den Zugang und gibt dessen offene
   Aufträge frei. Lokal beendet **Stoppen** den Helfer. Ein laufender WSL-Import
   wird dabei zuerst abgeschlossen. **Helfer entfernen** löscht nach einer
   Bestätigung nur die lokalen Daten und die eigene WSL-Distribution dieses BTS.
   Registrierter Name und bereits übertragene Audios bleiben im BTS.

Der Nutzer wählt **1 bis 16 CPU-Kerne**, höchstens die verfügbaren Kerne;
Vorgabe sind zwei. Die Prozessaffinität begrenzt den Helfer auf die gewählte
Anzahl. Unter Linux gilt Nice 10. Die **Modell-RAM-Abbruchgrenze** ist zwischen
2560 und 16384 MiB wählbar, Vorgabe 3584 MiB. Während Modellstart und Synthese
wird der RSS etwa alle 250 ms geprüft. Eine Überschreitung beendet den eigenen
Modellprozess und meldet einen Fehler. Das ist eine überwachte Abbruchgrenze;
kurzes Überschreiten ist möglich. Der WSL-Grundbedarf und Dateicaches kommen
hinzu. Vor dem Start müssen Budget plus 0,5 GiB Reserve frei sein.
Andere WSL-Programme und die globale `.wslconfig` werden nicht verändert.
Diese Begrenzung garantiert keine bestimmte BTP-Latenz unter Windows.

Das Fenster läuft getrennt von Einrichtung, Netzwerk und Helfer in einem
PowerShell-Runspace. Fortschritt und Status kommen über sichere Warteschlangen
zur Oberfläche. Ein Downloadabbruch unterbricht auch blockierende Netzwerkarbeit
und erhält die Teildatei. Ein offener Kontrollkanal bindet den Linux-Helfer an
das Fenster: Stop oder EOF beendet seine Arbeit auch bei einem unerwarteten
Ende des Starters. Es gibt keinen eigenen Helfer-Autostart oder Windows-Dienst.

Die Entfernung prüft zusätzlich zum eigenen Distributionsnamen den registrierten
Importpfad. Bei abweichendem Pfad wird sie abgebrochen. Verzeichnisverknüpfungen
werden beim Löschen nicht verfolgt. WSL als Windows-Komponente bleibt erhalten;
die separate Rücknahmeanleitung im Paket erklärt das weitere Vorgehen. Vor
dem Entfernen einer WSL-Distribution warnt auch die
[Microsoft-Dokumentation](https://learn.microsoft.com/windows/wsl/basic-commands#unregister-or-uninstall-a-linux-distribution)
vor dem dauerhaften Verlust ihrer Daten. Die heruntergeladene EXE wird nach
dem Schließen des Fensters vom Nutzer selbst gelöscht.

## Einzelne Windows-EXE

Der Download enthält einen kleinen, aus `Launcher.cs` gebauten .NET-Framework-
Starter und ein komprimiertes persönliches Paket. Windows 11 verwendet seine
vorhandene PowerShell-/Framework-Laufzeit. Die EXE entpackt nur fest vorgegebene
kleine Dateien in einen zufälligen temporären Ordner, öffnet das bisherige
Helferfenster, wartet auf dessen Ende und entfernt anschließend die Hilfsdateien.
Der Benutzer sieht im Downloadordner nur die EXE. Die Oberfläche nennt den
temporären Pfad und den davon getrennten dauerhaften Datenordner. Bei einem
unerwarteten Abbruch kann der temporäre Ordner verbleiben; nach dem Beenden
kann er manuell entfernt werden. Ein EXE-Start installiert noch keine Modelle.

Ein SHA-256-Wert erkennt beschädigte Paketdaten. Die EXE ist **nicht digital
signiert**; diese Prüfsumme ersetzt keine Herausgebersignatur. Windows kann
weiterhin eine Herausgeber-/SmartScreen-Warnung anzeigen. Der persönliche
Download enthält Kopplungsdaten und wird nicht öffentlich verteilt. Die
vorhandene große Linux-Laufzeit und bestehende WSL-Installationen bleiben
verwendbar; das Starterformat erfordert keinen neuen Modelldownload.

Die vorgebaute kleine `windows-launcher.bin` wird zusammen mit ihrem
Quellcode ausgeliefert. Reproduzierbarer Neubau auf dem Entwicklungsrechner
mit PowerShell 7 und den Referenzdateien aus Microsofts
[Microsoft.NETFramework.ReferenceAssemblies.net48 1.0.3](https://www.nuget.org/packages/Microsoft.NETFramework.ReferenceAssemblies.net48/1.0.3):

```sh
pwsh -File scripts/build-speech-helper-launcher.ps1 \
  -ReferenceDirectory /Pfad/zum/NuGet-Paket/build/.NETFramework/v4.8
```

Der Build lädt keine Dateien selbst nach. Roslyn kommt aus PowerShell; die
Referenzdateien werden nur zum Übersetzen benötigt und nicht mitgeliefert.
Die EXE-Paketlogik prüft Paketgröße und Integrität, erlaubt nur bekannte
Dateinamen und räumt ohne Verfolgen von Verzeichnisverknüpfungen auf. Der
Starter-Prüflauf führt diese Funktionen tatsächlich unter .NET aus. Der
Fensterstart der neuen EXE muss zusätzlich auf Windows geprüft werden.

## Code-Signing: vorbereitet, noch nicht aktiviert

Der Betreiber hat noch kein Code-Signing-Zertifikat und möchte als Privatperson
signieren. Die regulären Downloads bleiben deshalb **unsigniert**. Ein
HTTPS-Zertifikat und eine selbst ausgestellte Testsignatur ergeben keine
öffentlich bestätigte Windows-Herausgeberidentität. Microsoft erläutert die
Trennung zwischen [Signatur und SmartScreen-Reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation):
Auch gültig signierte neue Anwendungen können zunächst Warnungen anzeigen.

Der Starter ist nun Authenticode-kompatibel: Er liest das persönliche Paket
vor der im PE-Kopf ausgewiesenen Zertifikatstabelle, statt das Dateiende als
Paketende vorauszusetzen. Er berücksichtigt bis zu sieben Nullbytes für die
Signierausrichtung und prüft die Paket-Prüfsumme unverändert. Daten aus der
Zertifikatstabelle werden niemals als auszuführendes Starterpaket interpretiert.
Microsoft beschreibt die
[vom Signaturhash ausgenommenen Bereiche](https://learn.microsoft.com/en-us/windows/win32/secbp/understanding-pe-signatures).
Neue unsignierte Downloads werden bereits auf acht Bytes ausgerichtet.

Signiert werden muss die **fertige personalisierte EXE**. Ein signiertes
`windows-launcher.bin` und anschließend angehängte Zugangsdaten wären kein
korrekter Ersatz. Jede derzeit erzeugte persönliche EXE benötigt ihren eigenen
abschließenden Signiervorgang. Für einen späteren zentralen Releaseprozess wäre
ein unveränderlicher signierter Starter mit separater lokaler Kopplung sinnvoll;
dieser Architekturwechsel ist noch nicht umgesetzt. Signierschlüssel gehören
nicht auf sämtliche Turnierserver und niemals in das Repository.

Für den kontrollierten manuellen Signiervorgang auf einem Windows-Signierrechner
ist [sign-speech-helper.ps1](../scripts/sign-speech-helper.ps1) vorbereitet:

```powershell
.\scripts\sign-speech-helper.ps1 `
  -InputExe C:\Downloads\BTS-Sprachhelfer-Windows.exe `
  -OutputExe C:\Downloads\BTS-Sprachhelfer-signiert.exe `
  -CertificateThumbprint <Fingerabdruck-des-Code-Signing-Zertifikats> `
  -TimestampUrl https://<Zeitstempeldienst-des-Zertifikatanbieters>
```

Benötigt werden das Windows-SDK-SignTool und ein gültiges Code-Signing-Zertifikat
im Benutzer-Zertifikatsspeicher mit verfügbarem Hardware-/Cloud-Schlüssel.
`-MachineStore` wählt bei Bedarf den Computerkontext. Das Skript erzeugt eine neue
Ausgabedatei, signiert mit SHA-256 und RFC-3161-Zeitstempel, prüft mit der
Windows-Authenticode-Richtlinie, vergleicht Herausgeber und persönliche Paketdaten
und entfernt seine Ausgabe bei einem Fehler. Vorhandene Dateien werden nicht
überschrieben. Private Schlüssel und Kennwörter werden nicht als Parameter
benötigt. Es gibt keine automatische Bestellung oder Identitätsprüfung.

Für eine Privatperson außerhalb USA/Kanada steht Microsofts Public-Trust-
[Artifact Signing derzeit nicht bereit](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
[Certum Standard](https://www.certum.eu/en/code-signing-certificates/) unterstützt
Privatpersonen mit Identitätsprüfung. Die günstigere
[Open-Source-Variante](https://support.certum.eu/en/code-signing-required-documents/)
setzt unter anderem ein öffentliches Projekt und passende nichtkommerzielle
Nutzung voraus. Diese Voraussetzungen sind für unseren Download noch nicht
bestätigt; vor einer Bestellung sind Variante, Verfügbarkeit und Gesamtpreis zu
prüfen. SignPath Foundation bietet geeigneten OSS-Projekten
[kostenlose Signierung](https://signpath.org/terms.html), würde aber selbst als
Herausgeber auftreten und erfüllt damit nicht dieselbe Namenswahl.

Der private Starter-Prüflauf wurde zusätzlich mit echten, nur temporären
OpenSSL-Testzertifikaten und `osslsigncode 2.8` ausgeführt: ausgerichtete neue und
nicht ausgerichtete ältere Pakete lassen sich nach dem Signieren identisch
entpacken. Änderungen an den signierten Nutzdaten werden durch die
Authenticode-Prüfung abgelehnt; ein Paket innerhalb der Zertifikatstabelle wird
vom Launcher abgelehnt. Es wurde kein Testzertifikat in einen Zertifikatsspeicher
installiert, kein externer Zeitstempeldienst kontaktiert und keine Test-EXE
veröffentlicht. Das Produktions-Signierskript und Windows-Vertrauen mit einem
echten Herausgeberzertifikat bleiben mangels Zertifikat praktisch zu prüfen.

Reproduktion mit einem separat vorhandenen lokalen Testwerkzeug:

```sh
node debug/speech_helper_starter_probe.js /Pfad/zur/pwsh /Pfad/zu/osslsigncode
```

## Ubuntu und andere Linux-Systeme

1. **Linux-SH herunterladen** und im Terminal starten:
   `bash BTS-Sprachhelfer-Linux.sh`. Der Starter benötigt Python **3.8+**, Linux
   **x86_64** und dieselben CPU-Funktionen wie das Windows-Paket. Er enthält
   seinen Python-Quellcode und die persönliche Konfiguration selbst; keine
   zusätzlichen Starterdateien und keine pip-Installation sind nötig.
2. Das Menü zeigt Datenpfad, Downloadgröße, Datenübertragung, CPU-/RAM-Wahl,
   Abbruch und Entfernung. **Last messen** erzeugt einen lokalen Vorschlag;
   **Vorschlag übernehmen** ändert nur die Auswahl. Erst **Starten** beginnt mit
   Einrichtung und Verbindung. **Strg+C** unterbricht den aktuellen Vorgang und
   kehrt zum Menü zurück. `--info` zeigt nur Hinweise; `--remove` bietet die
   bestätigte Entfernung an.
3. Bubblewrap wird benötigt. Fehlt es, zeigt der Starter den konkreten Befehl
   für apt/dnf/zypper/pacman an und fragt gesondert vor `sudo` nach Zustimmung.
   Es werden nur konfigurierte Systempaketquellen verwendet. Ist die
   Distributionskonfiguration für Benutzer-Namensräume ungeeignet, wird mit
   einer verständlichen Meldung abgebrochen. Es gibt keine automatische
   Lockerung von AppArmor oder globalen Kernelregeln.
4. Download und Laufzeit liegen unter
   `${XDG_DATA_HOME:-~/.local/share}/bts-sprachhelfer/<BTS-Kennung>`.
   Unterbrochene Downloads werden fortgesetzt, SHA-256 wird vor dem Entpacken
   geprüft. Die vorbereitete Laufzeit enthält ihre eigenen Bibliotheken und
   ihren eigenen Python-Interpreter. Alte Versionen bleiben bis zur Entfernung
   erhalten; genügend freier Plattenplatz muss vorhanden sein.
5. Der Generator läuft ohne Host-Rootrechte in
   [Bubblewrap](https://github.com/containers/bubblewrap): Laufzeit nur lesbar,
   eigenes beschreibbares Sitzungsverzeichnis, eigenes `/tmp`, eigene
   Prozessansicht, minimale Geräte und DNS-Konfiguration. Persönliche Ordner
   werden nicht eingebunden. Das Host-Netzwerk wird zur BTS-Verbindung geteilt.
   CPU-Affinität, niedrige Priorität, Modell-RAM-Überwachung und der kontrollierte
   Stopkanal kommen aus derselben vorbereiteten Laufzeit wie unter WSL.
6. **Helfer entfernen** löscht nach Bestätigung ausschließlich die markierte
   eigene Installation. Ein laufender Helfer verhindert einen zweiten Start
   oder eine gleichzeitige Entfernung. Fremde Ordner und Verknüpfungsziele
   bleiben erhalten. Bubblewrap/Python als Systempakete, der SH-Download und
   BTS-Aufnahmen bleiben bestehen. Die SH kann anschließend gelöscht werden.

Der aktuelle Starter ist für Distributionen mit Python 3.8+, Bubblewrap und
geeigneter Namespace-Konfiguration ausgelegt. Eine pauschale Zusage für jede
Linux-Distribution wäre nicht belastbar; praktisch geprüft wird Ubuntu x86_64.
ARM ist derzeit nicht unterstützt. Ubuntu dokumentiert die
[AppArmor-Regeln für Benutzer-Namensräume](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
Die Menüoberfläche benötigt ein Terminal und kein GTK-/Qt-/Tk-Paket.

Gezielte Prüfungen:

```sh
node_modules/.bin/mocha test/test_speech_helpers.js
python3 -m unittest discover -s test -p test_speech_helper_linux.py -v
node debug/speech_helper_starter_probe.js /Pfad/zur/portablen/pwsh
node debug/speech_helper_linux_probe.js /Pfad/zum/privaten/Laufzeitpaket
```

Der letzte Prüflauf nutzt eine eigene HTTPS-Testinstanz und eine eigene
temporäre Installation. Er lädt das echte Paket lokal herunter, entpackt es,
fordert native Sprachgenerierung an, prüft den Rückweg als WAV, stoppt über das
Terminal, prüft Wiederverwendung und Auftragsabbruch und entfernt anschließend
seine eigene Installation. Es gibt keinen Zugriff auf ein produktives Turnier
oder BTP.

## Lokale Ressourcenempfehlung

Beim Öffnen misst ein eigener Hintergrundthread fünf Sekunden lang die CPU-Last
in Sekundenintervallen und den verfügbaren physischen sowie zusicherbaren
Speicher. Er startet weder WSL noch einen Modellprozess, schreibt keine Dateien
und überträgt die Messwerte nicht an BTS. Die Oberfläche bleibt bedienbar;
**Starten** und manuelle Wertewahl sind auch ohne Ergebnis möglich. Start oder
Entfernung beendet die Messung. Im laufenden Betrieb werden keine Budgets
automatisch angepasst. **Last neu messen** ist nach dem Stoppen wieder möglich.

Die Berechnung ist eine vorsichtige eigene Heuristik, keine Messung der späteren
Reaktionszeit von BTP:

- CPU: maximal vier logische Kerne und höchstens die Hälfte der verfügbaren
  Kerne. Ausgehend vom höchsten gemessenen Sekundenwert bleiben zusätzlich
  mindestens 35 Prozent der gesamten CPU-Kapazität frei. Passt kein ganzer
  Helferkern in diesen Spielraum, wird Warten empfohlen.
- RAM: 20 Prozent des Gesamtspeichers, mindestens 2 und höchstens 8 GiB,
  auf 256 MiB aufgerundet, bleiben als Reserve für Windows und weitere Nutzung.
  Weitere 1 GiB werden für WSL und Caches geschätzt. Auch die verfügbare
  Zusicherungsreserve begrenzt den Vorschlag. Empfohlen werden 3584 MiB
  Modellbudget; passt es samt Reserven nicht, wird Warten empfohlen. Die
  Empfehlung senkt nicht eigenständig die Modellgrenze, um es passend zu machen.

Der Reiter **Ressourcen** zeigt Messzeit, Durchschnitt, Lastspitze, kleinsten
freien RAM-Wert und Reserven. **Vorschlag übernehmen** ändert ausschließlich die
beiden Eingabefelder; erst **Starten** speichert und verwendet sie. Vorhandene
manuelle Werte werden durch Messen nicht überschrieben. Nach 60 Sekunden ist
der Vorschlag veraltet und muss erneut gemessen werden. Bei fehlenden oder
ungültigen Messdaten bleibt nur die manuelle Auswahl. Systeme mit mehreren
CPU-Gruppen erhalten derzeit keinen Vorschlag. Spätere Laständerungen,
Datenträgerzugriffe und andere WSL-Anwendungen kann diese Momentaufnahme nicht
vorhersagen. Modell-RAM ist eine Abbruchgrenze, keine Speicherreservierung.

Verwendet werden die Windows-APIs
[GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes)
und [GlobalMemoryStatusEx/MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex).
Die Kernelzeit enthält bereits Leerlauf; Differenzen werden vor der Umwandlung
in Gleitkommazahlen gebildet. Verfügbarer physischer Speicher umfasst auch
sofort wiederverwendbare Standby-Seiten. Die Schwellwerte oben stammen aus
unserer Heuristik, nicht aus diesen APIs.

Der Starter-Prüflauf prüft Lastspitzen, kleine und große Systeme, RAM- und
Zusicherungsengpässe, ungültige Zähler, lange Systemlaufzeiten sowie die echten
GUI-Funktionen für ausdrückliche Übernahme, unveränderte manuelle Werte und
veraltete Messungen. Die Helferprotokoll-/Pakettests bestehen weiterhin. Die
C#-Quelle wird mit C#-5-Sprachsyntax kompiliert; PowerShell-Skripte werden geparst.
Windows-APIs und Windows Forms selbst konnten auf diesem Linux-Rechner nicht
ausgeführt werden. Dafür ist ein erneuter Test auf Windows nötig.

## GPU-Nutzung: Stand und vorgesehene Prüfung

Der GPU-Ausbau ist vorerst zurückgestellt; beide Starter bleiben CPU-only.

Das aktuelle Paket verwendet ausschließlich die CPU. Unser nativer Worker
setzt `n_gpu_layers=0`, der Build deaktiviert CUDA und verwendet CPU-LibTorch.
Die [Kitten-C++-Dokumentation](https://github.com/KittenML/kitten-tts-2-cpp)
beschreibt außerdem das CPU-spezifische TQ2_1-Modellformat und den CPU-Decoder.
GPU-Unterstützung ist deshalb ein eigener Ausbau mit geprüfter Laufzeit und
gegebenenfalls anderen Modellartefakten. Ein Schalter allein würde hier keine
Beschleunigung bewirken.

[NVIDIA CUDA unter WSL](https://learn.microsoft.com/en-us/windows/ai/directml/gpu-cuda-in-wsl)
ist grundsätzlich möglich; ob es unseren gesamten Audioweg beschleunigt, muss
erst gemessen werden. Für einen späteren Ausbau ist vorgesehen: GPU lokal
anzeigen, Nutzung standardmäßig ausgeschaltet lassen, zusätzliche Downloads
und Treiberbedarf vorab erklären, CPU/GPU-Vergleich erst nach lokaler Freigabe
starten und Auswahl, Grafikspeicherbudget sowie Stoppen beim Nutzer belassen.
Ein Vergleich sollte Modellstart und wiederholte Aufnahmen mit identischen
Texten/Stimmen, Qualität und Belastung des Rechners berücksichtigen. Es gibt
derzeit keine implementierte GPU-Auswahl, keinen GPU-Benchmark und keinen
nachgewiesenen GPU-Geschwindigkeitsgewinn in unserem Helfer.

## Verifikation der Starter vom 25.10.2026

59 BTS-Tests für Helfer, Sprachprozess und Cache sowie zwölf Linux-Startertests
bestehen. Der PowerShell-Prüflauf bestätigt zusätzlich EXE-Paketintegrität,
Entpacken und Aufräumen mit dem tatsächlichen C#-Code. Der vollständige
Linux-SH-Test auf Ubuntu erzeugte eine echte Aufnahme mit zwei CPU-Kernen und
3584 MiB Modellbudget: rund 41,9 Sekunden einschließlich Modellstart, rund
64,9 Sekunden insgesamt einschließlich lokalem 2-GiB-Download und Entpacken.
Danach wurden Wiederverwendung, Abbruch eines zweiten Auftrags und lokale
Entfernung erfolgreich geprüft. Diese Zeiten sind keine Vergleichsmessung
zwischen physischen Rechnern. Der Windows-Start der neuen EXE und andere
Linux-Distributionen bleiben praktisch zu prüfen.
Siehe [Prüfergebnis](../debug/speech_helpers_launchers_2026-10-25.json).

## Persönliche Kopplung

Die persönliche Kopplung gilt acht Stunden. Nach erfolgreicher Anmeldung wird
eine eigene Sitzung im Helfer gespeichert, sodass weitere Starts kein neues
Paket benötigen. Nach Entzug des Zugangs ist ein neues Paket erforderlich.
Starter und Laufzeit enthalten Zugangsdaten bzw. private vorbereitete
Stimmprofile und gehören nicht in öffentliche Downloads. Der Sprachserver-
API-Schlüssel und die ursprünglichen Referenz-WAVs sind nicht enthalten.

## Datenweg und Wiederholung

Die Koordination läuft im bestehenden isolierten Sprachprozess. Aufträge und
Helferzustand liegen ausschließlich unter `speech-cache/helpers`, ohne
Turnierdatenbankzugriffe. Die bestehende Admin-WebSocket-Verbindung transportiert
Status, Steuerung und den kleinen Starterdownload (EXE oder SH). Die große Laufzeit und alle
Audiodateien gehen direkt über den separaten HTTP-/HTTPS-Anschluss dieses
Prozesses. Der BTS-Hauptprozess übernimmt weder Synthese noch Audiotransport.

Der Starter übernimmt den SHA-256-Fingerabdruck des BTS-Zertifikats. Downloader
und Helfer prüfen dieses Zertifikat vor dem Senden von Zugangsdaten; globale
Windows-Zertifikatsregeln werden nicht abgeschaltet. Bei einem Reverse Proxy
mit eigenem Zertifikat muss für diesen Prototyp der direkte Audioanschluss
verwendet werden.

Jeder Helfer bearbeitet höchstens einen Auftrag. Eine 90 Sekunden gültige
Zuweisung wird alle zehn Sekunden verlängert. Ohne Verlängerung wird der Auftrag
erneut verfügbar, nach drei abgelaufenen Versuchen als fehlgeschlagen markiert.
Eine verspätete Antwort eines früheren Versuchs kann das aktuelle Ergebnis nicht
überschreiben. Wiederholte Übertragung desselben angenommenen Ergebnisses ist
idempotent. BTS prüft zurückgegebene WAV-Dateien und speichert sie zentral;
Hörproben erhalten kurzlebige, signierte Abruflinks.

## Laufzeit auf dem BTS vorbereiten

Das private Paket wird auf dem Linux-Rechner mit der geprüften Kitten-C++-
Installation gebaut. Im Repository `bts-sprachserver`:

```sh
.venv/bin/python scripts/package-speech-helper.py \
  --output /home/tim/repos/bts/data/speech-cache/helpers
```

Für einen bewussten Neubau `--replace` ergänzen. Die Ausgabe muss zum wirksamen
`speech.cache_dir` des BTS passen. Der Builder prüft die bestehende native
Installation und verpackt Modell, Decoder, vorbereitete Stimmprofile, private
Bibliotheken und die benötigte Python-Standardlaufzeit. Er benötigt kein Docker
und verändert die laufende Sprachserverkonfiguration nicht. Die erste
Builder-Version unterstützt Ubuntu-System-Python 3.12 und Linux x64.

## Korrektur der WSL-Erkennung am 25.10.2026

Der Windows-Screenshot zeigte `/bin/bash: line 1: --status: command not found`.
Der Prozessstarter hatte jeden Parameter in Anführungszeichen gesetzt. Bei der
betroffenen WSL-Version wurde dadurch `"--status"` als Linux-Befehl behandelt,
statt die Windows-Statusabfrage auszuführen. Die GUI meldete vorhandenes WSL
deshalb fälschlich als nicht eingerichtet. Ein erneutes Installieren konnte
diesen Fehler im Starter nicht beheben.

`BtsHelperProcess.Quote` lässt einfache Parameter jetzt unverändert und verwendet
die Windows-Escapes nur für leere Argumente, Leerzeichen und eingebettete
Anführungszeichen. Das gilt auch für Listen, Import, gezielte Distribution und
Entfernung. Die
[WSL-Dokumentation](https://github.com/microsoft/WSL/blob/master/doc/docs/technical-documentation/wsl.exe.md)
beschreibt die eigene Verarbeitung der Befehlszeile durch `wsl.exe`.

Nach einer tatsächlich nötigen Einrichtung wird `--status` erneut abgefragt.
Ist WSL bereit, geht die Vorbereitung im selben Durchlauf weiter. Rückgabecodes
für einen erforderlichen Neustart und eine noch nicht bereite Installation
erhalten eigene Meldungen samt **Erneut prüfen**. Klickaktionen werden im Fenster
protokolliert; Fehler landen sichtbar in Status und Details. Die Buttonzeile
kann bei schmalem Fenster umbrechen.

Der Starter-Prüflauf deckt jetzt zusätzlich rohe WSL-Optionsnamen, unveränderte
Argumente mit Leerzeichen/Anführungszeichen sowie fünf Einrichtungsfälle ab:
Freigabe mit erfolgreicher Fortsetzung, notwendiger Neustart, weiterhin nicht
bereites WSL, Installationsfehler und Abbruch vor der Freigabe. WSL selbst und
UAC sind im Linux-Prüflauf simuliert; der erneute Windows-Test bleibt erforderlich.
Das Linux-Laufzeitpaket wurde für diese Korrektur nicht verändert. Vorhandene
Modelle und Downloads bleiben nutzbar.

## Verifikation vom 24.10.2026

57 gezielte BTS-Tests für Helferprotokoll, Ressourcenwahl, Audiocache und Sprachprozess sowie
fünf Python-Tests für Helfer-Audio, Speicherüberwachung, Kontrollkanal und Laufzeitprüfung sind bestanden. Der
PowerShell-Starter wurde mit PowerShell 7.6.7 geparst; sein tatsächlicher C#-
Downloader wurde gegen eine private HTTPS-Gegenstelle auf Zertifikatsablehnung
vor Anmeldung, Fortschritt, Download-Fortsetzung und Abbruch aus einem
Hintergrund-Runspace geprüft. Der tatsächliche Worker wurde zusätzlich mit einer
simulierten WSL-Gegenstelle ausgeführt: Ressourcenwahl wird übergeben; eine
fremde registrierte Importposition verhindert die Entfernung; eigene Dateien
werden entfernt und fremde Verknüpfungsziele bleiben bestehen. Windows Forms
und Windows PowerShell 5.1 konnten hier nicht ausgeführt werden.

Der Nutzer hat die bisherige Windows-Konsolenversion mit einer echten Aufnahme
bestätigt: BTS zeigte 25,1 Sekunden; die Hörprobe war gut. Das ist noch kein
praktischer Test der neuen grafischen Oberfläche.

Zusätzlich erzeugten zwei echte, aus demselben Rootfs gestartete Linux-Helfer
gleichzeitig jeweils eine native Aufnahme und lieferten sie über TLS an einen
isolierten BTS-Sprachprozess zurück. Die Dateien wurden anschließend über ihre
signierten HTTPS-Links abgerufen und als WAV geprüft. Dieser Lauf bestätigt
den Paketinhalt und Datenweg unter Linux; er misst keinen Geschwindigkeitsgewinn
auf zwei physischen Rechnern. Beide Testhelfer teilten hier denselben CPU-Kern.
Siehe [Messdaten](../debug/speech_helpers_2026-10-24.json).

Der [GUI-Folgetest](../debug/speech_helpers_gui_2026-10-24.json) dokumentiert
zusätzlich zwei echte parallele Aufnahmen mit Ressourcenüberwachung und den
Abbruch eines angenommenen nativen Auftrags nach EOF des Starter-Kontrollkanals.
Die aktualisierte Laufzeit enthält dafür einen eigenen Beobachter des Kanals;
nach einem unerwarteten Starterende läuft der Generator nicht unabhängig weiter.
Die Ressourcensteuerung erfordert gegenüber dem ersten Windows-Test eine neue
Laufzeitversion und damit erneut etwa 2 GiB Download. Alte Versionen bleiben
bis zur lokalen Entfernung erhalten.

Reproduktion mit vorbereitetem und entpacktem Rootfs:

```sh
node debug/speech_helper_probe.js /tmp/bts-helper-rootfs-check \
  /home/tim/repos/bts/data/speech-cache/helpers
node debug/speech_helper_starter_probe.js /Pfad/zur/portablen/pwsh
```

Der erste Test benötigt `bubblewrap` und eine lokale Socket-/Namespace-Freigabe.
Er verwendet eine eigene temporäre Datenbank, eigene Anschlüsse und eigene
Audiodateien, ohne Verbindung zu BTP oder einem produktiven Turnier.
