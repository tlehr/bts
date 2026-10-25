param([BtsHelperState]$State, [string]$PackageRoot, [ValidateSet('Run','Remove')][string]$Mode = 'Run', [int]$Threads = 2, [int]$MemoryMiB = 3584)
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Invoke-HelperProcess([string]$Executable, [string[]]$Arguments, [switch]$IgnoreCancel, [int]$TimeoutSeconds = 600) {
    $process = [BtsHelperProcess]::new($Executable, $Arguments)
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $process.Input('')
        while (-not $process.HasExited) {
            foreach ($line in $process.Drain()) { $lines.Add($line); $State.Report('log', $line) }
            if (-not $IgnoreCancel) { $State.CheckCancelled() }
            if ($clock.Elapsed.TotalSeconds -gt $TimeoutSeconds) { throw 'Windows-Befehl antwortet nicht rechtzeitig.' }
            Start-Sleep -Milliseconds 100
        }
        $code = $process.ExitCode
        foreach ($line in $process.Drain()) { $lines.Add($line); $State.Report('log', $line) }
        return [PSCustomObject]@{ ExitCode = $code; Lines = $lines.ToArray() }
    } finally { $process.Dispose() }
}

function Remove-Helper($Plan) {
    $State.Report('removing', 'Eigene Laufzeit und lokale Dateien entfernen ...')
    if (-not (Test-Path -LiteralPath $Plan.Root)) { $State.Report('removed', 'Keine lokale Helferinstallation gefunden. Die heruntergeladene EXE koennen Sie selbst loeschen.'); return }
    if ((Get-Item -LiteralPath $Plan.Root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Der Helferordner ist eine Verknuepfung. Bitte den Speicherort vor dem Entfernen pruefen.' }
    $prefix = 'BTS-Sprachhelfer-' + $Plan.ServerId + '-'
    # Verify the import location as well as the name, including old versions.
    foreach ($entry in @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue)) {
        $value = Get-ItemProperty -LiteralPath $entry.PSPath
        if ($value.DistributionName -notmatch ('^' + [Regex]::Escape($prefix) + '[a-f0-9]{12}$')) { continue }
        $actual = [IO.Path]::GetFullPath(($value.BasePath -replace '^\\\\\?\\', '')).TrimEnd('\')
        $expected = [IO.Path]::GetFullPath((Join-Path $Plan.Root $value.DistributionName)).TrimEnd('\')
        if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Eine gleichnamige WSL-Laufzeit liegt an einem anderen Ort. Entfernung wurde gestoppt.' }
        $State.Report('log', ('Entferne eigene WSL-Laufzeit: ' + $value.DistributionName))
        $result = Invoke-HelperProcess 'wsl.exe' @('--unregister', $value.DistributionName) -IgnoreCancel
        if ($result.ExitCode -ne 0) { throw 'WSL konnte die eigene Laufzeit nicht entfernen. Lokale Dateien bleiben erhalten; Details pruefen.' }
    }
    [BtsHelperFiles]::RemoveTree($Plan.Root)
    $State.Report('removed', 'Lokaler Helfer entfernt. WSL bleibt installiert. Die EXE koennen Sie nach dem Schliessen selbst loeschen; fertige Audios bleiben im BTS.')
}

function Read-HelperJobEvent([string]$Line) {
    try {
        $event = $Line.Substring('BTSHELPER_EVENT '.Length) | ConvertFrom-Json
        if ($event.event -ne 'job' -or $event.phase -notin @('generating','uploading','completed','failed','cancelled','waiting','paused')) { throw 'Ungueltiger Auftragsstatus.' }
        $value = @{ phase = [string]$event.phase }
        if ($event.phase -notin @('waiting','paused')) {
            if ($event.id -isnot [string] -or $event.id -notmatch '^[a-f0-9-]{32,36}$' -or
                $event.text -isnot [string] -or $event.text.Length -gt 1200 -or
                $event.voice -notin @('hallensprecher','hallensprecherin')) { throw 'Ungueltige Auftragsdaten.' }
            $value.id = $event.id
            $value.text = $event.text
            $value.voice = [string]$event.voice
        }
        $kind, $message = switch ($event.phase) {
            'generating' { 'working'; 'Audio wird erzeugt.' }
            'uploading' { 'uploading'; 'Fertige Aufnahme wird an BTS uebertragen.' }
            'completed' { 'ready'; 'Aufnahme an BTS uebergeben. Bereit fuer den naechsten Auftrag.' }
            'failed' { 'waiting'; 'Auftrag fehlgeschlagen oder neu vergeben. Warte auf den naechsten Auftrag.' }
            'cancelled' { 'stopping'; 'Laufender Auftrag wurde abgebrochen.' }
            'waiting' { 'ready'; 'Mit BTS verbunden. Warte auf Auftraege.' }
            'paused' { 'paused'; 'Im BTS pausiert. Es werden keine neuen Auftraege angenommen.' }
        }
        $State.Report($kind, $message)
        $State.Report('job', ($value | ConvertTo-Json -Compress))
    } catch { $State.Report('log', 'Eine Auftragsanzeige konnte nicht gelesen werden. Die Generierung wird fortgesetzt.') }
}

function Read-AgentMessages($Process) {
    foreach ($line in $Process.Drain()) {
        if ($line.StartsWith('BTSHELPER_EVENT ')) { Read-HelperJobEvent $line; continue }
        $State.Report('log', $line)
        if ($line.StartsWith('Sprachhelfer konnte nicht fortfahren: ')) {
            $message = $line.Substring('Sprachhelfer konnte nicht fortfahren: '.Length)
            if ($message -match 'helper_pair_expired|helper_unauthorized') { $message = 'Die Kopplung ist abgelaufen oder wurde getrennt. Bitte im BTS einen neuen Starter herunterladen.' }
            elseif ($message -match 'helper_update_required|versions differ') { $message = 'BTS hat eine neue Helferversion. Bitte den Starter erneut herunterladen.' }
            elseif ($message -match 'certificate changed') { $message = 'Das BTS-Zertifikat hat sich geaendert. Bitte einen neuen Starter vom BTS herunterladen.' }
            elseif ($message -match 'requires an x64 CPU') { $message = 'Dieser Helfer benoetigt einen x64-Prozessor mit AVX2/FMA/BMI2.' }
            $State.Report('error', $message)
        }
        elseif ($line.StartsWith('Mit BTS verbunden.')) { $State.Report('ready', 'Mit BTS verbunden. Bereit fuer automatische Sprachauftraege.') }
        elseif ($line.StartsWith('Testaufnahme wird')) { $State.Report('working', 'Testaufnahme wird erzeugt. Das kann einige Minuten dauern ...') }
        elseif ($line.StartsWith('Aufnahme an BTS')) { $State.Report('ready', 'Aufnahme an BTS uebergeben. Bereit fuer den naechsten Auftrag.') }
        elseif ($line.StartsWith('BTS nicht erreichbar')) { $State.Report('waiting', 'Verbindung zu BTS unterbrochen. Neuer Versuch erfolgt automatisch ...') }
        elseif ($line.StartsWith('Auftrag fehlgeschlagen')) { $State.Report('waiting', 'Auftrag fehlgeschlagen oder neu vergeben. Details stehen im BTS.') }
    }
}

function Stop-Agent([string]$Distro, [string]$PidPath, [string]$Signal) {
    # The PID belongs to this launch only. Never terminate another helper or
    # the entire WSL distribution when closing a second starter window.
    $code = @"
import os,signal,time
from pathlib import Path
p=Path('$PidPath')
for attempt in range(30):
    try:
        pid=int(p.read_text())
        args=Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(bytes([0]))
        if b'/opt/bts-speech-helper/agent.py' in args:
            if '$Signal' == 'SIGKILL':
                children=Path('/proc/'+str(pid)+'/task/'+str(pid)+'/children').read_text().split()
                for child in children:
                    try:
                        cmd=Path('/proc/'+child+'/cmdline').read_bytes().split(bytes([0]))
                        if b'/opt/bts-speech-helper/runtime/worker' in cmd:
                            os.kill(int(child),signal.SIGKILL)
                    except (FileNotFoundError,ProcessLookupError):
                        pass
            os.kill(pid,signal.$Signal)
            break
    except (FileNotFoundError,ProcessLookupError):
        pass
    time.sleep(.1)
"@
    Invoke-HelperProcess 'wsl.exe' @('--distribution', $Distro, '--cd', '/', '--exec', '/usr/bin/python3', '-c', $code) -IgnoreCancel -TimeoutSeconds 15 | Out-Null
}

try {
    . (Join-Path $PackageRoot 'Plan.ps1')
    $plan = Get-HelperPlan $PackageRoot
    $config = $plan.Config
    $mutex = [Threading.Mutex]::new($false, ('Local\BTS-Sprachhelfer-' + $plan.ServerId))
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Ein anderes Helferfenster arbeitet bereits fuer diesen BTS. Bitte dort zuerst Stoppen waehlen.' }
    if ($Mode -eq 'Remove') { Remove-Helper $plan; return }
    if ($Threads -lt 1 -or $Threads -gt 16 -or $Threads -gt [Environment]::ProcessorCount -or $MemoryMiB -lt 2560 -or $MemoryMiB -gt 16384) { throw 'Die Ressourcenwahl ist ungueltig.' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Dieses Testpaket benoetigt Windows x64; ARM wird noch nicht unterstuetzt.' }
    $State.Report('checking', 'Voraussetzungen automatisch pruefen ...')
    $os = Get-CimInstance Win32_OperatingSystem
    $freeGiB = [double]$os.FreePhysicalMemory / 1MB
    $State.Report('log', ('Freier Arbeitsspeicher: {0:N1} GiB' -f $freeGiB))
    if ($freeGiB -lt ($MemoryMiB / 1024.0 + .5)) { throw 'Fuer das gewaehlte Modell-RAM-Budget plus 0,5 GiB Reserve ist zu wenig freier Speicher vorhanden. Bitte Budget reduzieren oder andere Programme schliessen.' }
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    $wslReady = $false
    if ($wsl) { $status = Invoke-HelperProcess $wsl.Source @('--status'); $wslReady = $status.ExitCode -eq 0 }
    if (-not $wslReady) {
        $State.Report('setup', 'WSL muss eingerichtet werden. Bitte unten auf WSL einrichten klicken.')
        while ($State.InstallDecision -eq 0) { $State.CheckCancelled(); Start-Sleep -Milliseconds 100 }
        if ($State.InstallDecision -ne 1) { $State.Cancelled = $true; $State.CheckCancelled() }
        $State.Report('install', 'Windows richtet WSL ein. Bitte die Windows-Abfrage beachten ...')
        $installer = Start-Process powershell.exe -Verb RunAs -WindowStyle Normal -PassThru -Wait -ArgumentList '-NoProfile','-Command','wsl.exe --install --no-distribution --web-download; exit $LASTEXITCODE'
        $State.CheckCancelled()
        if ($installer.ExitCode -notin @(0,3010,1641)) { throw ('WSL-Einrichtung wurde abgebrochen oder ist fehlgeschlagen (Code ' + $installer.ExitCode + ').') }
        $State.Report('checking', 'WSL-Einrichtung beendet. Verfuegbarkeit erneut pruefen ...')
        $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
        if ($wsl) { $status = Invoke-HelperProcess $wsl.Source @('--status'); $wslReady = $status.ExitCode -eq 0 }
        if ($installer.ExitCode -in @(3010,1641)) {
            $State.Report('restart_required', 'Windows meldet einen erforderlichen Neustart. BTP speichern und regulaer beenden; danach Windows neu starten und diesen Starter erneut oeffnen.')
            return
        }
        if (-not $wslReady) {
            $State.Report('setup_pending', 'WSL ist noch nicht bereit. Details pruefen; falls Windows einen Neustart verlangt, BTP vorher speichern und beenden. Danach Erneut pruefen waehlen.')
            return
        }
        $State.Report('checking', 'WSL ist bereit. Vorbereitung wird fortgesetzt ...')
    }
    $localRoot = $plan.Root
    New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
    $deviceFile = Join-Path $localRoot 'device-id.txt'
    if (-not (Test-Path -LiteralPath $deviceFile)) { [IO.File]::WriteAllText($deviceFile, [Guid]::NewGuid().ToString()) }
    $config | Add-Member -NotePropertyName device_id -NotePropertyValue ([IO.File]::ReadAllText($deviceFile).Trim()) -Force
    $config | Add-Member -NotePropertyName name -NotePropertyValue $env:COMPUTERNAME -Force
    $config | Add-Member -NotePropertyName platform -NotePropertyValue 'Windows 11 / WSL 2' -Force
    $config.threads = $Threads
    $config | Add-Member -NotePropertyName memory_limit_mib -NotePropertyValue $MemoryMiB -Force
    [IO.File]::WriteAllText((Join-Path $localRoot 'settings.json'), (@{ threads = $Threads; memory_limit_mib = $MemoryMiB } | ConvertTo-Json))
    $State.Report('log', ('Freigegeben: ' + $Threads + ' CPU-Kerne, ' + $MemoryMiB + ' MiB Modell-RAM.'))
    $distro = $plan.Distribution
    $listing = Invoke-HelperProcess 'wsl.exe' @('--list', '--quiet')
    $existing = @($listing.Lines | ForEach-Object { $_.Trim() })
    if ($existing -notcontains $distro) {
        $archive = Join-Path $localRoot ('runtime-' + $config.runtime.sha256 + '.tar')
        $driveName = [IO.Path]::GetPathRoot($localRoot).Substring(0,1)
        $freeDisk = (Get-PSDrive -Name $driveName).Free
        if ($freeDisk -lt ([double]$config.runtime.size_bytes * 2.2 + 1GB)) { throw 'Zu wenig freier Speicher fuer Download und eigene WSL-Installation.' }
        $State.Report('verify', 'Vorhandene Laufzeit pruefen ...')
        $valid = (Test-Path -LiteralPath $archive) -and ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $config.runtime.sha256)
        if (-not $valid) {
            $State.CheckCancelled()
            $State.Report('download', 'Laufzeit und Modelle vom BTS laden ...')
            $partial = $archive + '.partial'
            $completePartial = (Test-Path -LiteralPath $partial) -and ((Get-Item -LiteralPath $partial).Length -eq $config.runtime.size_bytes)
            if (-not $completePartial) {
                if ((Test-Path -LiteralPath $partial) -and (Get-Item -LiteralPath $partial).Length -gt $config.runtime.size_bytes) { Remove-Item -LiteralPath $partial -Force }
                [BtsHelperDownload]::Fetch($config.endpoint + '/speech-helper/v1/runtime', $config.certificate_sha256, $config.bootstrap, $partial, [long]$config.runtime.size_bytes, $State)
            }
            $State.CheckCancelled()
            $State.Report('verify', 'Download pruefen (SHA-256) ...')
            if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.runtime.sha256) {
                Remove-Item -LiteralPath $partial -Force
                throw 'Pruefsumme stimmt nicht. Bitte den Starter erneut ausfuehren.'
            }
            Move-Item -LiteralPath $partial -Destination $archive -Force
        }
        $State.CheckCancelled()
        $State.Report('install', 'Eigene WSL-Laufzeit einrichten. Das kann einige Minuten dauern ...')
        $install = Join-Path $localRoot $distro
        New-Item -ItemType Directory -Force -Path $install | Out-Null
        # Let a running WSL import finish before stopping; interrupting it can
        # leave a registered but incomplete distribution behind.
        $import = Invoke-HelperProcess 'wsl.exe' @('--import', $distro, $install, $archive, '--version', '2') -IgnoreCancel
        $State.CheckCancelled()
        if ($import.ExitCode -ne 0) { throw 'WSL-Import fehlgeschlagen. Details pruefen; eventuell ist nach der WSL-Einrichtung noch ein Windows-Neustart erforderlich.' }
    }
    $State.CheckCancelled()
    $State.Report('connecting', ('Helfer mit BTS verbinden (maximal ' + $config.threads + ' CPU-Kerne) ...'))
    $pidPath = '/tmp/bts-helper-' + [Guid]::NewGuid().ToString('N') + '.pid'
    $launch = 'echo $$ > ' + $pidPath + '; exec /usr/bin/python3 /opt/bts-speech-helper/agent.py --config-stdin --watch-stdin --events'
    $agent = [BtsHelperProcess]::new('wsl.exe', [string[]]@('--distribution', $distro, '--cd', '/', '--exec', '/bin/sh', '-c', $launch))
    try {
        $agent.Send(($config | ConvertTo-Json -Depth 8 -Compress))
        while (-not $agent.HasExited -and -not $State.Cancelled) { Read-AgentMessages $agent; Start-Sleep -Milliseconds 100 }
        if ($State.Cancelled -and -not $agent.HasExited) {
            $State.Report('stopping', 'Sprachhelfer wird beendet. Eine laufende Testaufnahme wird abgebrochen ...')
            try { $agent.Send('stop') } catch { $State.Report('log', 'Warte auf Ende des eigenen Helferprozesses ...') }
            $until = [DateTime]::UtcNow.AddSeconds(40)
            while (-not $agent.HasExited -and [DateTime]::UtcNow -lt $until) { Read-AgentMessages $agent; Start-Sleep -Milliseconds 100 }
            if (-not $agent.HasExited) { Stop-Agent $distro $pidPath 'SIGKILL' }
            $State.CheckCancelled()
        }
        $exit = $agent.ExitCode
        Read-AgentMessages $agent
        if ($exit -ne 0) {
            if ($State.LastError) { throw $State.LastError }
            throw 'Der Sprachhelfer wurde mit einem Fehler beendet. Bitte die Details pruefen.'
        }
        $State.Report('stopped', 'Sprachhelfer beendet.')
    } finally { $agent.Dispose() }
} catch {
    if ($State.Cancelled) { $State.Report('stopped', 'Sprachhelfer beendet. Ein angefangener Download wird beim naechsten Start fortgesetzt.') }
    else { $State.ExitCode = 1; $State.Report('error', $_.Exception.Message) }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    $State.Finished = $true
}
