$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'Runtime.cs')
. (Join-Path $PSScriptRoot 'Plan.ps1')
$plan = Get-HelperPlan $PSScriptRoot
[Windows.Forms.Application]::EnableVisualStyles()

$script:helperState = [BtsHelperState]::new()
$script:helperCloseRequested = $false
$script:helperEnded = $true
$script:operation = $null
$script:worker = $null
$script:runspace = $null
$script:helperMode = 'Run'
$script:helperRetrySetup = $false
$script:helperProbe = $null
$script:helperAdvice = $null
$script:helperCurrentJob = $null
$script:helperJobClock = $null
$script:helperAccent = [Drawing.ColorTranslator]::FromHtml('#376b70')
$script:helperForm = [Windows.Forms.Form]::new()
$helperForm.Text = 'BTS-Sprachhelfer'
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$helperForm.ClientSize = [Drawing.Size]::new([Math]::Min(800, $area.Width - 60), [Math]::Min(900, $area.Height - 60))
$helperForm.MinimumSize = [Drawing.Size]::new(640, 700)
$helperForm.StartPosition = 'CenterScreen'
$helperForm.AutoScaleMode = 'Dpi'
$helperForm.Font = [Drawing.Font]::new('Segoe UI', 10)
$helperForm.BackColor = [Drawing.ColorTranslator]::FromHtml('#f4f6f6')

$layout = [Windows.Forms.TableLayoutPanel]::new()
$layout.Dock = 'Fill'
$layout.Padding = [Windows.Forms.Padding]::new(24)
$layout.ColumnCount = 1
$layout.RowCount = 11
foreach ($height in @(44,32,42,52,62,28,44)) { $layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Absolute, $height)) }
$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Absolute, 150))
$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Absolute, 26))
$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Percent, 100))
$layout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::AutoSize))
$helperForm.Controls.Add($layout)

$title = [Windows.Forms.Label]::new()
$title.Text = 'BTS-Sprachhelfer'
$title.Font = [Drawing.Font]::new('Segoe UI', 19, [Drawing.FontStyle]::Bold)
$title.ForeColor = $helperAccent
$title.Dock = 'Fill'
$layout.Controls.Add($title, 0, 0)
$address = [Windows.Forms.Label]::new()
$address.Dock = 'Fill'
$address.AutoEllipsis = $true
$address.Text = 'BTS: ' + $plan.Config.endpoint
$layout.Controls.Add($address, 0, 1)

$steps = [Windows.Forms.TableLayoutPanel]::new()
$steps.ColumnCount = 4
$steps.Dock = 'Fill'
$script:helperSteps = @()
foreach ($text in @('1. Pruefen', '2. Laufzeit laden', '3. Einrichten', '4. Verbinden')) {
    $steps.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]::Percent, 25))
    $label = [Windows.Forms.Label]::new()
    $label.Text = $text
    $label.Dock = 'Fill'
    $label.TextAlign = 'MiddleLeft'
    $label.AutoEllipsis = $true
    $helperSteps += $label
    $steps.Controls.Add($label)
}
$layout.Controls.Add($steps, 0, 2)
$resources = [Windows.Forms.FlowLayoutPanel]::new()
$resources.Dock = 'Fill'
$cpuLabel = [Windows.Forms.Label]::new()
$cpuLabel.Text = 'CPU-Kerne:'
$cpuLabel.AutoSize = $true
$cpuLabel.Padding = [Windows.Forms.Padding]::new(0, 5, 0, 0)
$resources.Controls.Add($cpuLabel)
$script:helperCpu = [Windows.Forms.NumericUpDown]::new()
$helperCpu.Minimum = 1
$helperCpu.Maximum = [Math]::Min(16, [Environment]::ProcessorCount)
$helperCpu.Value = [Math]::Min(2, $helperCpu.Maximum)
$helperCpu.Width = 60
$resources.Controls.Add($helperCpu)
$ramLabel = [Windows.Forms.Label]::new()
$ramLabel.Text = 'Modell-RAM-Abbruchgrenze (MiB):'
$ramLabel.AutoSize = $true
$ramLabel.Padding = [Windows.Forms.Padding]::new(16, 5, 0, 0)
$resources.Controls.Add($ramLabel)
$script:helperRam = [Windows.Forms.NumericUpDown]::new()
$helperRam.Minimum = 2560
$helperRam.Maximum = 16384
$helperRam.Increment = 256
$helperRam.Value = 3584
$helperRam.Width = 90
$resources.Controls.Add($helperRam)
try {
    $saved = Get-Content -LiteralPath (Join-Path $plan.Root 'settings.json') -Raw | ConvertFrom-Json
    $helperCpu.Value = [Math]::Max(1, [Math]::Min($helperCpu.Maximum, [int]$saved.threads))
    $helperRam.Value = [Math]::Max(2560, [Math]::Min(16384, [int]$saved.memory_limit_mib))
} catch { }
$layout.Controls.Add($resources, 0, 3)
$script:helperStatus = [Windows.Forms.Label]::new()
$helperStatus.Dock = 'Fill'
$helperStatus.Text = 'Bitte Hinweise lesen und Ressourcen waehlen. Erst Starten beginnt.'
$helperStatus.Font = [Drawing.Font]::new('Segoe UI', 11, [Drawing.FontStyle]::Bold)
$layout.Controls.Add($helperStatus, 0, 4)
$script:helperProgress = [Windows.Forms.ProgressBar]::new()
$helperProgress.Dock = 'Fill'
$helperProgress.Style = 'Blocks'
$helperProgress.MarqueeAnimationSpeed = 30
$layout.Controls.Add($helperProgress, 0, 5)
$script:helperProgressText = [Windows.Forms.Label]::new()
$helperProgressText.Dock = 'Fill'
$helperProgressText.Text = 'WSL und Dateicaches benoetigen zusaetzlichen RAM. Es wurden noch keine Aenderungen vorgenommen.'
$helperProgressText.ForeColor = [Drawing.ColorTranslator]::FromHtml('#596f77')
$layout.Controls.Add($helperProgressText, 0, 6)
$jobBox = [Windows.Forms.GroupBox]::new()
$jobBox.Text = 'Aktueller Auftrag'
$jobBox.Dock = 'Fill'
$jobLayout = [Windows.Forms.TableLayoutPanel]::new()
$jobLayout.Dock = 'Fill'
$jobLayout.Padding = [Windows.Forms.Padding]::new(8, 0, 8, 6)
$jobLayout.ColumnCount = 1
$jobLayout.RowCount = 3
$jobLayout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Absolute, 25))
$jobLayout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Absolute, 24))
$jobLayout.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]::Percent, 100))
$script:helperJobStatus = [Windows.Forms.Label]::new()
$helperJobStatus.Text = 'Noch kein Auftrag angenommen.'
$helperJobStatus.Dock = 'Fill'
$helperJobStatus.Font = [Drawing.Font]::new('Segoe UI', 10, [Drawing.FontStyle]::Bold)
$jobLayout.Controls.Add($helperJobStatus, 0, 0)
$script:helperJobMeta = [Windows.Forms.Label]::new()
$helperJobMeta.Dock = 'Fill'
$helperJobMeta.AutoEllipsis = $true
$jobLayout.Controls.Add($helperJobMeta, 0, 1)
$script:helperJobText = [Windows.Forms.TextBox]::new()
$helperJobText.Multiline = $true
$helperJobText.ReadOnly = $true
$helperJobText.ScrollBars = 'Vertical'
$helperJobText.Dock = 'Fill'
$helperJobText.BackColor = [Drawing.Color]::White
$jobLayout.Controls.Add($helperJobText, 0, 2)
$jobBox.Controls.Add($jobLayout)
$layout.Controls.Add($jobBox, 0, 7)
$detailTitle = [Windows.Forms.Label]::new()
$detailTitle.Text = 'Hinweise und laufende Rueckmeldungen'
$detailTitle.Dock = 'Fill'
$layout.Controls.Add($detailTitle, 0, 8)
$script:helperLog = [Windows.Forms.TextBox]::new()
$helperLog.Multiline = $true
$helperLog.ReadOnly = $true
$helperLog.ScrollBars = 'Vertical'
$helperLog.Dock = 'Fill'
$helperLog.BackColor = [Drawing.Color]::White
$script:helperTabs = [Windows.Forms.TabControl]::new()
$helperTabs.Dock = 'Fill'
$informationTab = [Windows.Forms.TabPage]::new('Was passiert auf meinem Rechner?')
$information = [Windows.Forms.TextBox]::new()
$information.Multiline = $true
$information.ReadOnly = $true
$information.ScrollBars = 'Vertical'
$information.Dock = 'Fill'
$information.BackColor = [Drawing.Color]::White
$information.Text = $plan.Text.Replace("`n", "`r`n").Replace("`r`r`n", "`r`n")
$informationTab.Controls.Add($information)
$helperTabs.TabPages.Add($informationTab)
$script:helperDetailsTab = [Windows.Forms.TabPage]::new('Laufende Details')
$helperDetailsTab.Controls.Add($helperLog)
$helperTabs.TabPages.Add($helperDetailsTab)
$resourceTab = [Windows.Forms.TabPage]::new('Ressourcen')
$script:helperResourceDetails = [Windows.Forms.TextBox]::new()
$helperResourceDetails.Multiline = $true
$helperResourceDetails.ReadOnly = $true
$helperResourceDetails.ScrollBars = 'Vertical'
$helperResourceDetails.Dock = 'Fill'
$helperResourceDetails.BackColor = [Drawing.Color]::White
$helperResourceDetails.Text = 'Die lokale Messung liest fuenf Sekunden lang CPU-Last und freien Speicher. Sie aendert keine Einstellungen und sendet keine Lastdaten an BTS.'
$resourceTab.Controls.Add($helperResourceDetails)
$helperTabs.TabPages.Add($resourceTab)
$layout.Controls.Add($helperTabs, 0, 9)
$buttons = [Windows.Forms.FlowLayoutPanel]::new()
$buttons.Dock = 'Top'
$buttons.AutoSize = $true
$buttons.AutoSizeMode = 'GrowAndShrink'
$buttons.Padding = [Windows.Forms.Padding]::new(0, 8, 0, 0)
$script:helperStart = [Windows.Forms.Button]::new()
$helperStart.Text = 'Starten'
$helperStart.AutoSize = $true
$buttons.Controls.Add($helperStart)
$script:helperInstall = [Windows.Forms.Button]::new()
$helperInstall.Text = 'WSL einrichten'
$helperInstall.AutoSize = $true
$helperInstall.Visible = $false
$buttons.Controls.Add($helperInstall)
$copy = [Windows.Forms.Button]::new()
$copy.Text = 'Details kopieren'
$copy.AutoSize = $true
$copy.Add_Click({ Invoke-HelperUiAction 'Details kopieren' { if ($helperLog.Text) { [Windows.Forms.Clipboard]::SetText($helperLog.Text) } } })
$buttons.Controls.Add($copy)
$script:helperStop = [Windows.Forms.Button]::new()
$helperStop.Text = 'Schliessen'
$helperStop.AutoSize = $true
$buttons.Controls.Add($helperStop)
$script:helperRemove = [Windows.Forms.Button]::new()
$helperRemove.Text = 'Helfer entfernen'
$helperRemove.AutoSize = $true
$buttons.Controls.Add($helperRemove)
$script:helperMeasure = [Windows.Forms.Button]::new()
$helperMeasure.Text = 'Last neu messen'
$helperMeasure.AutoSize = $true
$buttons.Controls.Add($helperMeasure)
$script:helperApplyAdvice = [Windows.Forms.Button]::new()
$helperApplyAdvice.Text = 'Vorschlag uebernehmen'
$helperApplyAdvice.AutoSize = $true
$helperApplyAdvice.Enabled = $false
$buttons.Controls.Add($helperApplyAdvice)
$layout.Controls.Add($buttons, 0, 10)

function Add-HelperLog([string]$Message) {
    if (-not $Message.Trim()) { return }
    if ($helperLog.Lines.Count -gt 300) { $helperLog.Lines = $helperLog.Lines | Select-Object -Last 250 }
    $helperLog.AppendText(('[' + [DateTime]::Now.ToString('HH:mm:ss') + '] ' + $Message + [Environment]::NewLine))
}
function Update-HelperJobTime {
    if (-not $helperCurrentJob -or -not $helperJobClock) { return }
    $elapsed = $helperJobClock.Elapsed
    $duration = '{0:00}:{1:00}' -f ([Math]::Floor($elapsed.TotalMinutes)), $elapsed.Seconds
    $voice = if ($helperCurrentJob.voice -eq 'hallensprecherin') { 'Hallensprecherin' } else { 'Hallensprecher' }
    $value = $voice + ' | Auftrag ' + $helperCurrentJob.id.Substring(0, 8) + ' | Dauer ' + $duration
    if ($helperJobClock.IsRunning) { $value += ' | seit ' + $helperCurrentJob.started.ToString('HH:mm:ss') }
    if ($helperJobMeta.Text -ne $value) { $helperJobMeta.Text = $value }
}
function Set-HelperJob([string]$Message) {
    $event = $Message | ConvertFrom-Json
    if ($event.phase -in @('waiting','paused')) {
        $helperJobStatus.Text = if ($event.phase -eq 'paused') { 'Pausiert. Keine neuen Auftraege.' } else { 'Bereit. Warte auf Auftraege.' }
        if ($helperCurrentJob) {
            $helperJobStatus.Text = if ($event.phase -eq 'paused') { 'Pausiert. ' } else { 'Bereit. ' }
            $helperJobStatus.Text += 'Letzter Auftrag: ' + $helperCurrentJob.outcome + '.'
        }
        return
    }
    if ($event.phase -eq 'generating') {
        $script:helperCurrentJob = [PSCustomObject]@{ id = $event.id; voice = $event.voice; started = [DateTime]::Now; outcome = 'in Bearbeitung' }
        $script:helperJobClock = [Diagnostics.Stopwatch]::StartNew()
        $helperJobText.Text = $event.text.Replace("`n", "`r`n").Replace("`r`r`n", "`r`n")
        Add-HelperLog ('Auftrag ' + $event.id + ' | Stimme: ' + $event.voice + ' | Text: ' + $event.text)
    }
    if (-not $helperCurrentJob -or $helperCurrentJob.id -ne $event.id) { return }
    if ($event.phase -in @('completed','failed','cancelled')) {
        $helperJobClock.Stop()
        $helperCurrentJob.outcome = switch ($event.phase) { 'completed' { 'abgeschlossen' } 'failed' { 'fehlgeschlagen oder neu vergeben' } 'cancelled' { 'abgebrochen' } }
    }
    $helperJobStatus.Text = switch ($event.phase) {
        'generating' { 'Audio wird erzeugt.' }
        'uploading' { 'Fertige Aufnahme wird an BTS uebertragen.' }
        'completed' { 'Letzter Auftrag abgeschlossen und an BTS uebergeben.' }
        'failed' { 'Letzter Auftrag fehlgeschlagen oder neu vergeben.' }
        'cancelled' { 'Letzter Auftrag abgebrochen.' }
    }
    Update-HelperJobTime
}
function Stop-HelperJob([string]$Message) {
    if ($helperJobClock -and $helperJobClock.IsRunning) {
        $helperJobClock.Stop()
        $helperCurrentJob.outcome = 'unterbrochen'
        $helperJobStatus.Text = $Message
        Update-HelperJobTime
    }
}
function Start-HelperResourceProbe {
    if (-not $helperEnded) { return }
    if ($helperProbe) { $helperProbe.Cancel() }
    $script:helperAdvice = $null
    $helperApplyAdvice.Enabled = $false
    $helperMeasure.Enabled = $false
    $helperProgressText.Text = 'Lokale Lastmessung: 5 Sekunden. Ihre Werte bleiben unveraendert. Sie koennen weiterhin selbst waehlen und starten.'
    Add-HelperLog 'Lokale CPU-/RAM-Messung gestartet; keine Installation, keine Datenuebertragung.'
    $script:helperProbe = [BtsHelperResourceProbe]::new()
}
function Apply-HelperResourceAdvice {
    if (-not $helperEnded -or -not $helperAdvice -or -not $helperAdvice.CanRecommend -or -not $helperAdvice.IsFresh) { return }
    $helperCpu.Value = [Math]::Min($helperCpu.Maximum, $helperAdvice.Threads)
    $helperRam.Value = $helperAdvice.MemoryMiB
    Add-HelperLog ('Vorschlag auf Nutzerwunsch uebernommen: ' + $helperCpu.Value + ' CPU-Kerne, ' + $helperRam.Value + ' MiB Modell-RAM. Starten bleibt eine eigene Entscheidung.')
}
function Update-HelperResourceAdvice {
    if (-not $helperEnded) { return }
    if ($helperProbe -and $helperProbe.Result) {
        $script:helperAdvice = $helperProbe.Result
        $script:helperProbe = $null
        $helperMeasure.Enabled = $true
        $helperApplyAdvice.Enabled = $helperAdvice.CanRecommend -and $helperAdvice.IsFresh
        $summary = $helperAdvice.Reason
        if ($helperAdvice.Available) {
            $load = ('CPU {0:N0}% im Mittel, Spitze {1:N0}%; mindestens {2:N1} GiB RAM frei.' -f $helperAdvice.AverageCpu, $helperAdvice.PeakCpu, ($helperAdvice.AvailableMiB / 1024.0))
            if ($helperAdvice.CanRecommend) {
                $summary = ('Vorschlag: {0} CPU-Kerne, {1} MiB Modell-RAM. Nur per Klick uebernehmen.' -f $helperAdvice.Threads, $helperAdvice.MemoryMiB)
            }
            $helperProgressText.Text = $summary + [Environment]::NewLine + 'Details im Reiter Ressourcen.'
            $helperResourceDetails.Text = $summary + "`r`n`r`n" + $load + "`r`nMesszeit: " + $helperAdvice.MeasuredAtUtc.ToLocalTime().ToString('HH:mm:ss') + ". Gueltig fuer 60 Sekunden.`r`n`r`n" +
                ('Reserve fuer Windows und weitere Programme: {0:N1} GiB, dazu 1 GiB geschaetzter WSL-/Cachebedarf. Auch freier zugesicherter Speicher wird beruecksichtigt.' -f ($helperAdvice.ReserveMiB / 1024.0)) + "`r`n`r`n" +
                'Der Vorschlag nutzt hoechstens die Haelfte der logischen CPU-Kerne, maximal vier, und laesst anhand der gemessenen Lastspitze mindestens 35% CPU-Spielraum. Fuer das Modell werden 3584 MiB empfohlen. Passt dieses Budget samt Reserven nicht, wird Warten empfohlen. Mehr RAM-Budget macht das Modell nicht automatisch schneller; kleinere manuelle Abbruchgrenzen koennen die Generierung vorzeitig beenden.' + "`r`n`r`n" +
                'Dies ist eine Momentaufnahme und keine Leistungsgarantie. Neue Programme, Datentraegerlast und andere WSL-Anwendungen koennen die Nutzung beeintraechtigen. Die RAM-Grenze gilt nur fuer den Modellprozess. Rohdaten dieser Messung bleiben lokal. Werte aendern sich nur durch Ihre Auswahl; Starten bleibt eine eigene Entscheidung.'
            Add-HelperLog ($summary + ' ' + $load)
        } else {
            $helperProgressText.Text = $summary
            $helperResourceDetails.Text = $summary + "`r`n`r`nManuelle Auswahl und Starten bleiben moeglich. Es wurden keine Werte geaendert."
            Add-HelperLog $summary
        }
    }
    if ($helperAdvice -and -not $helperAdvice.IsFresh) {
        $helperApplyAdvice.Enabled = $false
        $script:helperAdvice = $null
        $helperProgressText.Text = 'Die Ressourcenempfehlung ist veraltet. Bitte Last neu messen oder Werte selbst waehlen.'
    }
}
function Invoke-HelperUiAction([string]$Name, [scriptblock]$Action) {
    try { Add-HelperLog ('Aktion: ' + $Name); & $Action }
    catch {
        Set-HelperPhase 'error' ('Die Aktion konnte nicht ausgefuehrt werden: ' + $_.Exception.Message)
        $helperTabs.SelectedTab = $helperDetailsTab
    }
}
function Set-HelperPhase([string]$Kind, [string]$Message) {
    $helperStatus.Text = $Message
    $helperStatus.ForeColor = if ($Kind -eq 'error') { [Drawing.Color]::Firebrick } else { $helperAccent }
    $helperProgress.Style = 'Marquee'
    $helperProgressText.Text = switch ($Kind) {
        'download' { 'Verbindung zum BTS aufbauen. Ein vorhandener Download wird fortgesetzt.' }
        'verify' { 'Datei wird geprueft. Das Fenster bleibt bedienbar.' }
        'install' { 'Einrichtung laeuft. Beim Stoppen wird dieser Schritt zuerst abgeschlossen.' }
        'connecting' { 'Modelle pruefen und beim BTS anmelden ...' }
        'ready' { 'Bereit fuer automatische Sprachauftraege vom BTS. Dieses Fenster offen lassen.' }
        'working' { 'Die erste Aufnahme kann durch das Laden der Modelle laenger dauern.' }
        'uploading' { 'Die Aufnahme ist erzeugt. Die Uebertragung muss noch von BTS bestaetigt werden.' }
        'paused' { 'Die Freigabe kann im BTS unter Sprachhelfer fortgesetzt werden. Stoppen bleibt hier moeglich.' }
        'setup' { 'Windows fragt nach Administratorrechten. Ein Neustart kann erforderlich sein.' }
        'restart_required' { 'Es wird kein Neustart automatisch ausgeloest. Nach dem Neustart den Starter erneut oeffnen.' }
        'setup_pending' { 'Mit Erneut pruefen den aktuellen WSL-Stand abfragen. Die Details bleiben hier sichtbar.' }
        'error' { 'Details koennen kopiert werden. Danach das Fenster schliessen und erneut starten.' }
        'removing' { 'Nur die eigene Helferinstallation wird geloescht. Bitte diesen Schritt abschliessen lassen.' }
        default { '' }
    }
    $step = switch ($Kind) { 'checking' {0} 'download' {1} 'verify' {1} 'setup' {0} 'install' {2} 'connecting' {3} 'ready' {4} 'working' {4} 'uploading' {4} 'paused' {4} default {-1} }
    for ($i = 0; $i -lt $helperSteps.Count; $i++) {
        $helperSteps[$i].ForeColor = if ($i -lt $step) { [Drawing.Color]::DarkGreen } elseif ($i -eq $step) { $helperAccent } else { [Drawing.Color]::DimGray }
    }
    if ($Kind -in @('ready','paused','setup','restart_required','setup_pending','error','stopped','removed')) {
        $helperProgress.Style = 'Blocks'
        $helperProgress.Value = if ($Kind -eq 'ready') {100} else {0}
    }
    if ($Kind -eq 'setup') { $helperInstall.Visible = $true }
    if ($Kind -in @('error','stopped','removed')) { Stop-HelperJob ('Letzter Auftrag unterbrochen: ' + $Message) }
    if ($Kind -in @('restart_required','setup_pending')) {
        $script:helperRetrySetup = $true
        $helperStart.Text = 'Erneut pruefen'
    }
    Add-HelperLog $Message
}
function Request-HelperStop {
    if ($helperEnded) { $helperForm.Close(); return }
    if ($helperMode -eq 'Remove') {
        $helperStatus.Text = 'Die Entfernung wird gerade abgeschlossen. Das Fenster schliesst danach.'
        return
    }
    $helperState.Cancelled = $true
    $helperInstall.Enabled = $false
    $helperStop.Enabled = $false
    $helperStatus.Text = 'Beenden angefordert. Bitte kurz warten ...'
    if ($helperJobClock -and $helperJobClock.IsRunning) { $helperJobStatus.Text = 'Abbruch des laufenden Auftrags angefordert ...' }
    $helperProgressText.Text = 'Downloads werden angehalten. Eine laufende WSL-Einrichtung wird zuerst abgeschlossen.'
}
$helperStop.Add_Click({ Invoke-HelperUiAction 'Stoppen oder Schliessen' { Request-HelperStop } })
$helperStart.Add_Click({ Invoke-HelperUiAction 'Starten' { Start-HelperTask 'Run' } })
$helperMeasure.Add_Click({ Invoke-HelperUiAction 'Last neu messen' { Start-HelperResourceProbe } })
$helperApplyAdvice.Add_Click({ Invoke-HelperUiAction 'Vorschlag uebernehmen' { Apply-HelperResourceAdvice } })
$helperRemove.Add_Click({
    Invoke-HelperUiAction 'Helfer entfernen' {
    $answer = [Windows.Forms.MessageBox]::Show($helperForm,
        ('Die eigene WSL-Laufzeit und alle Helferdateien unter ' + $plan.Root + ' werden geloescht. Das kann nicht rueckgaengig gemacht werden. WSL, andere Distributionen, die heruntergeladene EXE sowie bereits uebertragene BTS-Aufnahmen bleiben erhalten. Lokalen Helfer jetzt entfernen?'),
        'Helfer entfernen', [Windows.Forms.MessageBoxButtons]::YesNo, [Windows.Forms.MessageBoxIcon]::Question, [Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($answer -eq [Windows.Forms.DialogResult]::Yes) { Start-HelperTask 'Remove' }
    }
})
$helperInstall.Add_Click({
    Invoke-HelperUiAction 'WSL einrichten' {
    $answer = [Windows.Forms.MessageBox]::Show($helperForm,
        'WSL jetzt mit Administratorrechten einrichten? Windows kann danach einen Neustart verlangen. Vor einem Neustart BTP speichern und regulaer beenden.',
        'WSL einrichten', [Windows.Forms.MessageBoxButtons]::YesNo, [Windows.Forms.MessageBoxIcon]::Question, [Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($answer -eq [Windows.Forms.DialogResult]::Yes) {
        $helperInstall.Enabled = $false
        $helperStatus.Text = 'Windows-Freigabe fuer WSL wird angefordert ...'
        Add-HelperLog 'WSL-Einrichtung im Bestaetigungsdialog freigegeben.'
        $helperState.InstallDecision = 1
    } else { Add-HelperLog 'WSL-Einrichtung nicht freigegeben. Es wurde kein Installationsauftrag gestartet.' }
    }
})
$helperForm.Add_FormClosing({
    param($sender, $eventArgs)
    if (-not $helperEnded) { $eventArgs.Cancel = $true; $script:helperCloseRequested = $true; Request-HelperStop }
})

function Start-HelperTask([string]$Mode) {
    if (-not $helperEnded) { return }
    if ($helperProbe) { $helperProbe.Cancel(); $script:helperProbe = $null }
    $script:helperAdvice = $null
    $helperMeasure.Enabled = $helperApplyAdvice.Enabled = $false
    if ($worker) { $worker.Dispose(); $runspace.Dispose() }
    $script:helperState = [BtsHelperState]::new()
    $script:helperCurrentJob = $null
    $script:helperJobClock = $null
    $helperJobText.Text = $helperJobMeta.Text = ''
    $helperJobStatus.Text = 'Noch kein Auftrag angenommen.'
    $script:helperRetrySetup = $false
    $helperStart.Text = 'Starten'
    $script:helperMode = $Mode
    $script:helperEnded = $false
    $helperStart.Enabled = $helperRemove.Enabled = $helperCpu.Enabled = $helperRam.Enabled = $false
    $helperStop.Text = 'Stoppen'
    $helperStop.Enabled = $Mode -eq 'Run'
    $helperInstall.Visible = $false
    $helperInstall.Enabled = $true
    $helperTabs.SelectedTab = $helperDetailsTab
    $decision = if ($Mode -eq 'Run') { 'Helferstart nach Nutzerentscheidung' } else { 'Lokale Entfernung bestaetigt' }
    Add-HelperLog ($decision + '. Budget: ' + $helperCpu.Value + ' CPU-Kerne, ' + $helperRam.Value + ' MiB Modell-RAM.')
    $script:runspace = [RunspaceFactory]::CreateRunspace()
    $runspace.ApartmentState = 'MTA'
    $runspace.Open()
    $script:worker = [PowerShell]::Create()
    $worker.Runspace = $runspace
    $null = $worker.AddScript('param($root, $state, $mode, $threads, $memory) & (Join-Path $root "Worker.ps1") -State $state -PackageRoot $root -Mode $mode -Threads $threads -MemoryMiB $memory').AddArgument($PSScriptRoot).AddArgument($helperState).AddArgument($Mode).AddArgument([int]$helperCpu.Value).AddArgument([int]$helperRam.Value)
    $script:operation = $worker.BeginInvoke()
}
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 150
$timer.Add_Tick({
    Update-HelperResourceAdvice
    foreach ($item in $helperState.Drain()) {
        if ($item.Kind -eq 'log') { Add-HelperLog $item.Message }
        elseif ($item.Kind -eq 'job') { Set-HelperJob $item.Message }
        elseif ($item.Kind -eq 'progress') {
            $helperProgress.Style = 'Blocks'
            $percent = if ($item.Total -gt 0) { [Math]::Min(100, [Math]::Floor(100.0 * $item.Current / $item.Total)) } else {0}
            $helperProgress.Value = [int]$percent
            $helperProgressText.Text = ('{0}% - {1:N0} / {2:N0} MiB - {3:N1} MiB/s' -f $percent, ($item.Current / 1MB), ($item.Total / 1MB), ($item.Speed / 1MB))
        }
        else { Set-HelperPhase $item.Kind $item.Message }
    }
    Update-HelperJobTime
    if ($operation -and $operation.IsCompleted -and -not $helperEnded) {
        $script:helperEnded = $true
        try { $worker.EndInvoke($operation) | Out-Null } catch { Set-HelperPhase 'error' $_.Exception.Message }
        if ($worker.Streams.Error.Count -gt 0 -and -not $helperState.Finished) { Set-HelperPhase 'error' $worker.Streams.Error[0].Exception.Message }
        $helperStop.Text = 'Schliessen'
        $helperStop.Enabled = $true
        $helperInstall.Visible = $false
        $helperStart.Enabled = $helperRemove.Enabled = $helperCpu.Enabled = $helperRam.Enabled = $true
        $helperMeasure.Enabled = $true
        if ($helperRetrySetup) { $helperStart.Text = 'Erneut pruefen' }
        if ($helperCloseRequested) { $helperForm.Close() }
    }
})
$timer.Start()
$helperForm.Add_Shown({ Invoke-HelperUiAction 'Lokale Ressourcenempfehlung' { Start-HelperResourceProbe } })
try { $helperForm.ShowDialog() | Out-Null }
finally { if ($helperProbe) { $helperProbe.Cancel() }; $timer.Stop(); $timer.Dispose(); if ($worker) { $worker.Dispose(); $runspace.Dispose() }; $helperForm.Dispose() }
