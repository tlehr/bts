param(
    [Parameter(Mandatory=$true)][string]$InputExe,
    [Parameter(Mandatory=$true)][string]$OutputExe,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$CertificateThumbprint,
    [Parameter(Mandatory=$true)][Uri]$TimestampUrl,
    [string]$SignTool = 'signtool.exe',
    [switch]$MachineStore
)
$ErrorActionPreference = 'Stop'
# Sign the FINAL personalized download, never just windows-launcher.bin.
# The private key stays in the Windows certificate store / hardware or cloud
# provider. No PFX files, passwords, keys or personal download enter this repo.
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Dieses Signierskript benoetigt Windows und das Microsoft Windows SDK SignTool.' }
if ($TimestampUrl.Scheme -ne 'https' -or $TimestampUrl.UserInfo -or -not $TimestampUrl.Host) { throw 'Bitte eine HTTPS-Adresse des Zeitstempeldiensts Ihres Zertifikatanbieters angeben.' }
$inputPath = [IO.Path]::GetFullPath($InputExe)
$outputPath = [IO.Path]::GetFullPath($OutputExe)
if ($inputPath.Equals($outputPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ein- und Ausgabedatei muessen verschieden sein.' }
if (Test-Path -LiteralPath $outputPath) { throw 'Die Ausgabedatei existiert bereits. Sie wird nicht ueberschrieben.' }
$tool = (Get-Command $SignTool -ErrorAction Stop).Source
$store = if ($MachineStore) { 'Cert:\LocalMachine\My' } else { 'Cert:\CurrentUser\My' }
$certificate = Get-Item -LiteralPath (Join-Path $store $CertificateThumbprint)
if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le [DateTime]::Now -or $certificate.NotBefore -gt [DateTime]::Now) { throw 'Das ausgewaehlte Zertifikat ist nicht gueltig oder sein privater Signierschluessel ist nicht verfuegbar.' }
if (@($certificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' }).Count -eq 0) { throw 'Das Zertifikat ist kein Code-Signing-Zertifikat.' }
if (-not ('BtsHelperLauncher' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot '../static/speech-helper/Launcher.cs') -ReferencedAssemblies 'System.dll','System.Core.dll','System.IO.Compression.dll','System.Windows.Forms.dll'
}
$before = [BtsHelperLauncher]::ReadPayload($inputPath)
$created = $false
try {
    $helperOutputStream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $created = $true
    try {
        $helperInputStream = [IO.File]::OpenRead($inputPath)
        try { $helperInputStream.CopyTo($helperOutputStream) } finally { $helperInputStream.Dispose() }
    } finally { $helperOutputStream.Dispose() }
    $arguments = @('sign','/fd','SHA256','/sha1',$CertificateThumbprint,'/s','My')
    if ($MachineStore) { $arguments += '/sm' }
    $arguments += @('/tr',$TimestampUrl.AbsoluteUri,'/td','SHA256','/d','BTS-Sprachhelfer',$outputPath)
    & $tool @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Signatur oder Zeitstempel fehlgeschlagen. Es wird keine signierte Ausgabe veroeffentlicht.' }
    & $tool verify /pa /all /tw $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Windows konnte die Signatur samt Zeitstempel nicht bestaetigen.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $outputPath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint -or -not $signature.TimeStamperCertificate) { throw 'Herausgeber, Vertrauenskette oder Zeitstempel stimmen nicht.' }
    $after = [BtsHelperLauncher]::ReadPayload($outputPath)
    if ([Convert]::ToBase64String($before) -cne [Convert]::ToBase64String($after)) { throw 'Die persoenlichen Paketdaten wurden beim Signieren veraendert.' }
    Write-Output ('Signierte EXE erstellt: ' + $outputPath)
    Write-Output ('Herausgeber: ' + $signature.SignerCertificate.Subject)
    Write-Output 'Die Signatur garantiert nicht, dass Microsoft SmartScreen bereits eine positive Reputation kennt.'
} catch {
    if ($created) { Remove-Item -LiteralPath $outputPath -Force }
    throw
}
