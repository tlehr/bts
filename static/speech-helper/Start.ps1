$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'Window.ps1')
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(('Der Sprachhelfer konnte nicht gestartet werden. Bitte den Starter erneut vom BTS herunterladen. Details: ' + $_.Exception.Message), 'BTS-Sprachhelfer', 'OK', 'Error') | Out-Null
    exit 1
}
