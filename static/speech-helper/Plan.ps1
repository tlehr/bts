function Get-HelperPlan([string]$PackageRoot) {
    $config = Get-Content -LiteralPath (Join-Path $PackageRoot 'helper.json') -Raw | ConvertFrom-Json
    $uri = [Uri]$config.endpoint
    if ($config.protocol -ne 1 -or $config.runtime.sha256 -notmatch '^[a-f0-9]{64}$' -or
        $uri.Scheme -notin @('https','http') -or $uri.UserInfo -or $uri.AbsolutePath -ne '/') { throw 'Starter-Konfiguration ist ungueltig.' }
    if ($uri.Scheme -eq 'https' -and $config.certificate_sha256 -notmatch '^[a-f0-9]{64}$') { throw 'BTS-Zertifikat fehlt.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($config.endpoint)))).Replace('-','').Substring(0,12).ToLowerInvariant() }
    finally { $sha.Dispose() }
    $root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('BTS-Sprachhelfer\' + $id)
    $text = @"
Die Nutzung ist freiwillig. Erst Starten beginnt mit WSL-Pruefung und Einrichtung. Beim Oeffnen misst das Fenster bereits fuenf Sekunden lang die lokale CPU-Last und den freien Speicher, ohne Installation, Netzwerkzugriff oder Aenderungen an Ihren Einstellungen. Diese Messwerte werden nicht an BTS gesendet.

Die einzelne EXE entpackt ihre kleinen Hilfsdateien temporaer nach:
$PackageRoot
Nach dem Schliessen des Fensters entfernt der EXE-Starter diesen temporaeren Ordner. Modelle und Einstellungen liegen gesondert im unten genannten Datenordner. Sie koennen die Hilfsdateien waehrend der Nutzung dort auch einsehen. Bei unerwartetem Abbruch kann dieser temporaere Ordner verbleiben; nach dem Beenden des Helfers koennen Sie ihn loeschen.

Auf diesem Rechner: Falls diese Laufzeitversion noch fehlt, ca. $([Math]::Round($config.runtime.size_bytes / 1GB, 1)) GiB Download vom BTS. Eine neue Laufzeitversion kann einen erneuten Download erfordern. Modelle, vorbereitete Stimmprofile und eine eigene WSL-Laufzeit werden hier gespeichert:
$root
Download und entpackte Laufzeit benoetigen zusammen etwa 5-6 GiB freien Plattenplatz pro Version. Alte Versionen bleiben bis Helfer entfernen zusaetzlich gespeichert. Der Helfer richtet keinen eigenen Windows-Autostart oder Windows-Dienst ein. WSL ist eine zusaetzliche Windows-Komponente. Nach dem Schliessen muss der Helfer erneut gestartet werden.

Rechenleistung: Sie waehlen CPU-Kerne und Modell-RAM-Abbruchgrenze. Bei Modellstart und Generierung wird der Modellprozess etwa alle 250 ms ueberwacht und bei Ueberschreitung beendet. Kurzzeitiges Ueberschreiten ist moeglich. WSL selbst und Dateicaches benoetigen zusaetzlichen Speicher. Das Budget gilt nur fuer den Modellprozess; andere WSL-Programme werden nicht umkonfiguriert.

Der Ressourcen-Vorschlag gilt fuer 60 Sekunden und wird nur per Klick auf Vorschlag uebernehmen eingetragen. Sie koennen jederzeit vor dem Start selbst Werte waehlen. Last neu messen erneuert den Vorschlag, ohne Ihre Wahl zu aendern. Unter Ressourcen sehen Sie Messwerte und geschaetzte Reserven. Eine Momentaufnahme garantiert keine unbeeintraechtigte weitere Nutzung. GPU-Nutzung ist in dieser Laufzeit nicht enthalten.

Datenaustausch: BTS erhaelt Rechnername, Geraetekennung, Plattform, Ressourcenwahl und Status. Der Helfer empfaengt Texte fuer Durchsagen (einschliesslich Spielernamen) sowie Testtexte und sendet die erzeugten Audios an $($config.endpoint). Die Aufnahmen bleiben im BTS. Kein Zugriff auf BTP oder Windows-Dateiordner aus der Linux-Laufzeit.

Falls WSL fehlt, wird seine Windows-Installation gesondert angeboten. Sie laedt Komponenten von Microsoft und kann Administratorrechte, Windows-Funktionen und einen Neustart benoetigen. Vor einem Neustart BTP speichern und beenden.

Stoppen: beendet den Helfer; ein Download bleibt zum Fortsetzen gespeichert. Bei laufender WSL-Einrichtung wird dieser Schritt zuerst abgeschlossen.

Helfer entfernen: meldet die eigene Laufzeit bei WSL ab und loescht ihren lokalen Download, Modelle, Einstellungen und Sitzungsdaten. Andere WSL-Distributionen bleiben erhalten. WSL und aktivierte Windows-Funktionen bleiben bestehen, da andere Programme sie nutzen koennen. Die heruntergeladene EXE koennen Sie nach dem Schliessen selbst loeschen. Rechnername und fertige Audios im BTS werden dadurch nicht geloescht.

Es erfolgt kein automatischer Windows-Neustart. Zur vollstaendigen Ruecknahme einer eigens eingerichteten WSL-Installation siehe RUECKNAHME.txt im Starter-Paket.
"@
    if ($uri.Scheme -eq 'http') { $text += "`r`n`r`nDiese BTS-Adresse verwendet HTTP: Texte, Audios und Zugangsdaten werden unverschluesselt uebertragen. Fuer Verschluesselung im BTS einen HTTPS-Starter erstellen." }
    return [PSCustomObject]@{ Config = $config; ServerId = $id; Root = $root; Distribution = ('BTS-Sprachhelfer-' + $id + '-' + $config.runtime.sha256.Substring(0,12)); Text = $text }
}
