'use strict';
// Optional portable PowerShell: parse the Windows starter and exercise its real
// C# HTTPS downloader against a private TLS fixture. No WSL or BTP changes.
const fs = require('fs/promises'), os = require('os'), path = require('path'), https = require('https'), crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const assert = require('assert');
async function main(executable, signer) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-helper-starter-'));
    const certificate = path.join(directory, 'tls.crt'), key = path.join(directory, 'tls.key');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate,
        '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const cert = await fs.readFile(certificate), pin = crypto.createHash('sha256').update(new crypto.X509Certificate(cert).raw).digest('hex');
    const bytes = Buffer.alloc(8192, 42), requests = [];
    const server = https.createServer({ cert, key: await fs.readFile(key) }, (req, res) => {
        requests.push(req.headers);
        if (req.headers.authorization !== 'Bearer fixture-only-key') { res.writeHead(401).end(); return; }
        if (req.url === '/slow') {
            res.writeHead(200, { 'Content-Length': 8 * 1024 * 1024 });
            const timer = setInterval(() => res.write(Buffer.alloc(32768, 42)), 30);
            res.on('close', () => clearInterval(timer)); return;
        }
        const start = /^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1];
        if (start) res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + (bytes.length - 1) + '/' + bytes.length });
        res.end(bytes.subarray(Number(start) || 0));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const script = path.join(directory, 'check.ps1');
    const psQuote = value => '\'' + value.replace(/'/g, '\'\'') + '\'';
    const packageDir = path.join(directory, 'package'), binaries = path.join(directory, 'bin');
    await fs.mkdir(packageDir); await fs.mkdir(binaries);
    await fs.mkdir(path.join(directory, 'share'));
    for (const name of ['Worker.ps1', 'Plan.ps1']) await fs.copyFile(path.resolve(__dirname, '../static/speech-helper', name), path.join(packageDir, name));
    const fixture = { protocol: 1, endpoint: 'https://helper-fixture.example:4434', certificate_sha256: pin, runtime: { id: 'a'.repeat(64), sha256: 'a'.repeat(64), size_bytes: 8192 }, threads: 2, bootstrap: 'fixture-only-key' };
    await fs.writeFile(path.join(packageDir, 'helper.json'), JSON.stringify(fixture));
    const { bundle, zip } = require('../bts/speech/helpers/bundle');
    const launcher = await bundle({ pair: async () => ({ key: fixture.bootstrap, runtime: fixture.runtime, expires: 1 }) }, fixture.endpoint, pin);
    const launcherFile = path.join(directory, 'BTS-Sprachhelfer.exe');
    await fs.writeFile(launcherFile, Buffer.from(launcher.content_base64, 'base64'));
    await fs.writeFile(path.join(directory, 'bad.zip'), zip({ '../outside.txt': 'forbidden' }));
    // Regression: the PE certificate table is excluded from the Authenticode
    // content hash. The launcher must never execute a package from that area.
    const certificatePayload = await fs.readFile(launcherFile);
    const launcherSize = (await fs.stat(path.resolve(__dirname, '../static/speech-helper/windows-launcher.bin'))).size;
    const optional = certificatePayload.readUInt32LE(0x3c) + 24;
    const securityDirectory = optional + (certificatePayload.readUInt16LE(optional) === 0x10b ? 128 : 144);
    certificatePayload.writeUInt32LE(launcherSize, securityDirectory);
    certificatePayload.writeUInt32LE(certificatePayload.length - launcherSize, securityDirectory + 4);
    await fs.writeFile(launcherFile + '-certificate-data', certificatePayload);
    let signedChecks = '';
    if (signer) {
        const testCert = path.join(directory, 'sign-test.crt'), testKey = path.join(directory, 'sign-test.key');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', testKey, '-out', testCert,
            '-days', '1', '-subj', '/CN=BTS isolated signing fixture - NOT TRUSTED', '-addext', 'basicConstraints=critical,CA:FALSE',
            '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=codeSigning'], { stdio: 'ignore' });
        const sign = (input, output) => {
            execFileSync(signer, ['sign', '-certs', testCert, '-key', testKey, '-h', 'sha256', '-in', input, '-out', output], { stdio: 'pipe' });
            // Trust this test leaf only in this one verification command.
            execFileSync(signer, ['verify', '-CAfile', testCert, '-in', output], { stdio: 'pipe' });
        };
        const signed = launcherFile + '-signed', legacySigned = launcherFile + '-legacy-signed';
        sign(launcherFile, signed);
        const original = await fs.readFile(launcherFile), stubSize = (await fs.stat(path.resolve(__dirname, '../static/speech-helper/windows-launcher.bin'))).size;
        assert.strictEqual(original.length % 8, 0);
        const legacy = Buffer.concat([original.subarray(0, stubSize), Buffer.from([0]), original.subarray(stubSize)]);
        await fs.writeFile(launcherFile + '-legacy', legacy); sign(launcherFile + '-legacy', legacySigned);
        const corrupted = await fs.readFile(signed); corrupted[stubSize + 50] ^= 1;
        await fs.writeFile(signed + '-corrupt', corrupted);
        assert.throws(() => execFileSync(signer, ['verify', '-CAfile', testCert, '-in', signed + '-corrupt'], { stdio: 'pipe' }), 'Authenticode accepted changed payload');
        signedChecks = `
foreach ($signedFile in @(${psQuote(signed)}, ${psQuote(legacySigned)})) {
    $signedPayload = [BtsHelperLauncher]::ReadPayload($signedFile)
    if ([Convert]::ToBase64String($signedPayload) -cne [Convert]::ToBase64String($payload)) { throw 'Authenticode signing changed or hid personal payload' }
    [IO.Directory]::CreateDirectory($extracted) | Out-Null
    [BtsHelperLauncher]::Extract($signedPayload, $extracted)
    [BtsHelperLauncher]::Cleanup($extracted)
}
`;
    }
    await fs.writeFile(path.join(binaries, 'wsl.exe'), `#!/usr/bin/python3
import sys,json,hashlib,os
from pathlib import Path
args=sys.argv[1:]
if '--status' in args:
    root=Path(os.environ['BTS_HELPER_FIXTURE_ROOT'])
    if (root/'needs-setup').exists() and not (root/'setup-ready').exists():
        print('WSL is not ready')
        sys.exit(1)
    print('Default Version: 2')
elif '--list' in args:
    name='BTS-Sprachhelfer-'+hashlib.sha256(b'https://helper-fixture.example:4434').hexdigest()[:12]+'-'+'a'*12
    print(name)
elif '--unregister' in args: print('Fixture distribution removed')
else:
    data=json.loads(sys.stdin.readline())
    Path(os.environ['BTS_HELPER_FIXTURE_ROOT'],'budget.json').write_text(json.dumps({'threads':data['threads'],'memory':data['memory_limit_mib']}))
    print('Mit BTS verbunden. Fixture helper.')
    job={'event':'job','id':'a'*32,'voice':'hallensprecherin','text':'Mixed U17: "Bitte" auf Feld 6!','lease':'must-not-be-shown'}
    for phase in ('generating','uploading','completed','waiting','paused'):
        print('BTSHELPER_EVENT '+json.dumps(dict(job,phase=phase)))
    job.update(id='b'*32,voice='hallensprecher',text='Naechster Auftrag: Feld 13.')
    for phase in ('generating','failed'):
        print('BTSHELPER_EVENT '+json.dumps(dict(job,phase=phase)))
    print('BTSHELPER_EVENT invalid-json')
`);
    await fs.chmod(path.join(binaries, 'wsl.exe'), 0o700);
    const echoScript = path.join(directory, 'echo-args.py');
    await fs.writeFile(echoScript, 'import json,sys\nprint(json.dumps(sys.argv[1:]))\n');
    await fs.writeFile(script, `$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$parseFiles = @(Get-ChildItem ${psQuote(path.resolve(__dirname, '../static/speech-helper'))} -Filter '*.ps1') + @(Get-Item ${psQuote(path.resolve(__dirname, '../scripts/sign-speech-helper.ps1'))}, ${psQuote(path.resolve(__dirname, '../scripts/build-speech-helper-launcher.ps1'))})
foreach ($file in $parseFiles) {
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | Out-String) }
}
Add-Type -Path ${psQuote(path.resolve(__dirname, '../static/speech-helper/Runtime.cs'))} -CompilerOptions '/langversion:5' -IgnoreWarnings -WarningAction SilentlyContinue
# Run the real launcher's payload/extraction/cleanup functions on .NET here.
# Only its Windows MessageBox API is stubbed; Main/WinForms are not executed.
$launcherSource = [IO.File]::ReadAllText(${psQuote(path.resolve(__dirname, '../static/speech-helper/Launcher.cs'))})
$formStub = 'namespace System.Windows.Forms { public enum MessageBoxButtons { OK } public enum MessageBoxIcon { Error } public static class MessageBox { public static void Show(string text, string title, MessageBoxButtons buttons, MessageBoxIcon icon) { } } }'
Add-Type -TypeDefinition ($launcherSource + $formStub) -CompilerOptions '/langversion:5'
$exe = ${psQuote(launcherFile)}
$payload = [BtsHelperLauncher]::ReadPayload($exe)
$extracted = ${psQuote(path.join(directory, 'exe-extracted'))}
[IO.Directory]::CreateDirectory($extracted) | Out-Null
[BtsHelperLauncher]::Extract($payload, $extracted)
if (-not (Test-Path (Join-Path $extracted 'Window.ps1')) -or -not (Test-Path (Join-Path $extracted 'helper.json'))) { throw 'EXE companion extraction failed' }
[BtsHelperLauncher]::Cleanup($extracted)
if (Test-Path $extracted) { throw 'Temporary EXE files not removed' }
${signedChecks}
$failed = $false
try { $null = [BtsHelperLauncher]::ReadPayload(${psQuote(launcherFile + '-certificate-data')}) } catch { $failed = $true }
if (-not $failed) { throw 'Launcher accepted executable payload inside the unauthenticated certificate table' }
$damaged = [IO.File]::ReadAllBytes($exe)
$damaged[$damaged.Length - 57] = $damaged[$damaged.Length - 57] -bxor 1
[IO.File]::WriteAllBytes(($exe + '-damaged'), $damaged)
$failed = $false
try { $null = [BtsHelperLauncher]::ReadPayload($exe + '-damaged') } catch { $failed = $true }
if (-not $failed) { throw 'Corrupt EXE payload accepted' }
[IO.Directory]::CreateDirectory($extracted) | Out-Null
$failed = $false
try { [BtsHelperLauncher]::Extract([IO.File]::ReadAllBytes(${psQuote(path.join(directory, 'bad.zip'))}), $extracted) } catch { $failed = $true }
if (-not $failed -or (Test-Path ${psQuote(path.join(directory, 'outside.txt'))})) { throw 'EXE extraction allowed traversal' }
[BtsHelperLauncher]::Cleanup($extracted)
# Resource estimates: preserve CPU and memory headroom, use peak load, and
# decline advice when the measurement or remaining capacity is unsuitable.
foreach ($case in @(
    @(24, 5, 10, 65536, 50000, 50000, 4, 3584, $true),
    @(4, 5, 10, 16384, 12000, 12000, 2, 3584, $true),
    @(4, 30, 40, 16384, 12000, 12000, 1, 3584, $true),
    @(4, 10, 60, 16384, 12000, 12000, 0, 3584, $false),
    @(2, 5, 10, 8192, 7000, 7000, 1, 3584, $true),
    @(2, 5, 10, 8192, 6000, 6000, 1, 2816, $false),
    @(8, 5, 10, 8192, 5500, 5500, 4, 2304, $false),
    @(8, 5, 10, 16384, 12000, 3000, 4, 0, $false),
    @(1, 0, 0, 16384, 12000, 12000, 0, 3584, $false)
)) {
    $advice = [BtsHelperResourceAdvice]::Calculate($case[0], $case[1], $case[2], $case[3], $case[4], $case[5])
    if (-not $advice.Available -or $advice.Threads -ne $case[6] -or $advice.MemoryMiB -ne $case[7] -or $advice.CanRecommend -ne $case[8]) { throw ('Incorrect resource advice for ' + ($case -join ', ')) }
}
foreach ($case in @(@(0,0,0,8192,6000,6000), @(8,50,20,8192,6000,6000), @(8,0,0,8192,9000,9000), @(8,0,[double]::NaN,8192,6000,6000))) {
    if ([BtsHelperResourceAdvice]::Calculate($case[0], $case[1], $case[2], $case[3], $case[4], $case[5]).Available) { throw 'Invalid resource data accepted' }
}
# CPU kernel time includes idle; use integer differences even above 2^53.
$large = [ulong]::Parse('18014398509481984')
$percent = [BtsHelperResourceProbe]::CpuPercent($large, $large, $large, ($large + [ulong]750), ($large + [ulong]900), ($large + [ulong]100))
if ([Math]::Abs($percent - 25) -gt .001) { throw 'CPU counters lost precision or counted idle twice' }
$failedCounter = $false
try { $null = [BtsHelperResourceProbe]::CpuPercent(100,100,100,99,200,200) } catch { $failedCounter = $true }
if (-not $failedCounter) { throw 'Backwards CPU counter accepted' }

# Exercise the actual GUI functions with simple controls, without WinForms.
# Only explicit adoption may change a manual choice; stale/live advice cannot.
$windowAst = [Management.Automation.Language.Parser]::ParseFile(${psQuote(path.resolve(__dirname, '../static/speech-helper/Window.ps1'))}, [ref]$tokens, [ref]$errors)
foreach ($name in @('Update-HelperResourceAdvice', 'Apply-HelperResourceAdvice', 'Start-HelperResourceProbe', 'Set-HelperJob', 'Update-HelperJobTime', 'Stop-HelperJob')) {
    $definition = $windowAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)[0]
    Invoke-Expression $definition.Extent.Text
}
function Add-HelperLog([string]$Message) { }
$script:helperEnded = $true
$script:helperCpu = [PSCustomObject]@{ Value = 6; Maximum = 16 }
$script:helperRam = [PSCustomObject]@{ Value = 6144 }
$script:helperMeasure = [PSCustomObject]@{ Enabled = $false }
$script:helperApplyAdvice = [PSCustomObject]@{ Enabled = $false }
$script:helperProgressText = [PSCustomObject]@{ Text = '' }
$script:helperResourceDetails = [PSCustomObject]@{ Text = '' }
$script:helperAdvice = $null
$script:helperProbe = [PSCustomObject]@{ Result = [BtsHelperResourceAdvice]::Calculate(16,5,10,32768,24000,24000) }
Update-HelperResourceAdvice
if ($helperCpu.Value -ne 6 -or $helperRam.Value -ne 6144 -or -not $helperApplyAdvice.Enabled) { throw 'Measurement changed manual budget' }
Apply-HelperResourceAdvice
if ($helperCpu.Value -ne 4 -or $helperRam.Value -ne 3584) { throw 'Explicit adoption failed' }
$helperCpu.Value = 6; $helperRam.Value = 6144
$helperAdvice.MeasuredAtUtc = [DateTime]::UtcNow.AddSeconds(-61)
Apply-HelperResourceAdvice
Update-HelperResourceAdvice
if ($helperCpu.Value -ne 6 -or $helperRam.Value -ne 6144 -or $helperApplyAdvice.Enabled) { throw 'Stale advice applied' }
$script:helperAdvice = [BtsHelperResourceAdvice]::Calculate(16,5,10,32768,24000,24000)
$script:helperEnded = $false
Apply-HelperResourceAdvice
Start-HelperResourceProbe
if ($helperCpu.Value -ne 6 -or $helperRam.Value -ne 6144 -or $helperProbe) { throw 'Running helper allowed budget change or new measurement' }
$script:helperEnded = $true
$script:helperProbe = [PSCustomObject]@{ Result = [BtsHelperResourceAdvice]::Unavailable('Unavailable fixture') }
Update-HelperResourceAdvice
if ($helperApplyAdvice.Enabled -or $helperCpu.Value -ne 6 -or $helperRam.Value -ne 6144) { throw 'Unavailable metrics changed manual budget' }

# Run the actual job card functions: full text, voice, delivery phases,
# elapsed time, pause and replacement of a previous job without a new window.
$script:helperJobStatus = [PSCustomObject]@{ Text = '' }
$script:helperJobMeta = [PSCustomObject]@{ Text = '' }
$script:helperJobText = [PSCustomObject]@{ Text = '' }
$script:helperCurrentJob = $script:helperJobClock = $null
$firstJob = @{ id = ('a' * 32); voice = 'hallensprecherin'; text = 'Mixed U17: "Bitte" auf Feld 6!'; phase = 'generating' }
Set-HelperJob ($firstJob | ConvertTo-Json -Compress)
if ($helperJobText.Text -cne $firstJob.text -or -not $helperJobMeta.Text.Contains('Hallensprecherin') -or -not $helperJobClock.IsRunning) { throw 'Current job text, voice or elapsed clock missing' }
$clock = $helperJobClock
$firstJob.phase = 'uploading'
Set-HelperJob ($firstJob | ConvertTo-Json -Compress)
if ($helperJobClock -ne $clock -or -not $helperJobClock.IsRunning -or -not $helperJobStatus.Text.Contains('uebertragen')) { throw 'Upload lost current text or reset timer' }
$firstJob.phase = 'completed'
Set-HelperJob ($firstJob | ConvertTo-Json -Compress)
Set-HelperJob '{"phase":"waiting"}'
if ($helperJobClock.IsRunning -or -not $helperJobStatus.Text.Contains('abgeschlossen') -or $helperJobText.Text -cne $firstJob.text) { throw 'Confirmed result or retained text missing while waiting' }
Set-HelperJob '{"phase":"paused"}'
if (-not $helperJobStatus.Text.Contains('Pausiert') -or $helperJobText.Text -cne $firstJob.text) { throw 'Paused helper lost last job' }
$secondJob = @{ id = ('b' * 32); voice = 'hallensprecher'; text = 'Naechster Auftrag: Feld 13.'; phase = 'generating' }
Set-HelperJob ($secondJob | ConvertTo-Json -Compress)
Set-HelperJob ($firstJob | ConvertTo-Json -Compress)
if ($helperJobText.Text -cne $secondJob.text -or $helperJobMeta.Text.Contains('Hallensprecherin') -or -not $helperJobClock.IsRunning) { throw 'Old job replaced current job or retained stale voice' }
Stop-HelperJob 'Auftrag unterbrochen.'
if ($helperJobClock.IsRunning -or $helperJobStatus.Text -ne 'Auftrag unterbrochen.') { throw 'Stop/error retained running job indication' }

# Regression: affected WSL versions interpret a quoted option as a Linux
# command. Linux argv fixtures alone cannot expose that Windows-only parser.
foreach ($option in @('--status','--list','--quiet','--import','--distribution','--cd','--exec','--unregister')) {
    if ([BtsHelperProcess]::Quote($option) -cne $option) { throw ('WSL option was unnecessarily quoted: ' + $option) }
}
$arguments = @('', 'C:\\Users\\Example Name\\folder\\', 'embedded"quote', 'BTS-Sprachhelfer-simple')
$echo = [BtsHelperProcess]::new('/usr/bin/python3', [string[]](@(${psQuote(echoScript)}) + $arguments))
try {
    $echo.Input('')
    $until = [DateTime]::UtcNow.AddSeconds(5)
    while (-not $echo.HasExited -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 25 }
    if (-not $echo.HasExited -or $echo.ExitCode -ne 0) { throw 'Argument roundtrip failed' }
    $actualArguments = ($echo.Drain() -join '') | ConvertFrom-Json
    if ($actualArguments.Count -ne $arguments.Count) { throw 'Argument count changed' }
    for ($i=0; $i -lt $arguments.Count; $i++) { if ($arguments[$i] -cne $actualArguments[$i]) { throw 'Empty/spaced/quoted argument changed' } }
} finally { $echo.Dispose() }
$target = ${psQuote(path.join(directory, 'runtime.partial'))}
$url = 'https://127.0.0.1:${server.address().port}/runtime'
$failed = $false
try { [BtsHelperDownload]::Fetch($url, '${'0'.repeat(64)}', 'fixture-only-key', $target) } catch { $failed = $true }
if (-not $failed) { throw 'Wrong certificate accepted' }
[BtsHelperDownload]::Fetch($url, '${pin}', 'fixture-only-key', $target)
[IO.File]::WriteAllBytes($target, [IO.File]::ReadAllBytes($target)[0..1023])
[BtsHelperDownload]::Fetch($url, '${pin}', 'fixture-only-key', $target)
$progress = [BtsHelperState]::new()
[BtsHelperDownload]::Fetch($url, '${pin}', 'fixture-only-key', ($target + '-progress'), 8192, $progress)
$updates = $progress.Drain()
if ($updates[-1].Current -ne 8192 -or $updates[-1].Total -ne 8192 -or $updates.Count -lt 2) { throw 'Download progress missing' }
$state = [BtsHelperState]::new()
$task = [PowerShell]::Create()
$null = $task.AddScript('param($state, $target) [BtsHelperDownload]::Fetch("https://127.0.0.1:${server.address().port}/slow", "${pin}", "fixture-only-key", $target, 8388608, $state)').AddArgument($state).AddArgument($target + '-cancel')
$operation = $task.BeginInvoke()
$until = [DateTime]::UtcNow.AddSeconds(5)
while (-not (Test-Path -LiteralPath ($target + '-cancel')) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 50 }
Start-Sleep -Milliseconds 200
$state.Cancelled = $true
if (-not $operation.AsyncWaitHandle.WaitOne(3000)) { throw 'Cancel did not interrupt the background download' }
try { $task.EndInvoke($operation) | Out-Null } catch { }
$task.Dispose()
$partialSize = (Get-Item -LiteralPath ($target + '-cancel')).Length
if ($partialSize -le 0 -or $partialSize -ge 8388608) { throw 'Partial download not retained' }
[BtsHelperFiles]::RemoveTree(${psQuote(path.join(directory, 'own-cache'))})
. ${psQuote(path.join(packageDir, 'Plan.ps1'))}
$plan = Get-HelperPlan ${psQuote(packageDir)}
if (Test-Path -LiteralPath $plan.Root) { throw 'Read-only plan created app files' }
function Get-CimInstance { return [PSCustomObject]@{ FreePhysicalMemory = 48GB } }
$runState = [BtsHelperState]::new()
& ${psQuote(path.join(packageDir, 'Worker.ps1'))} -State $runState -PackageRoot ${psQuote(packageDir)} -Threads 1 -MemoryMiB 3072
if (-not $runState.Finished -or $runState.ExitCode -ne 0) { throw (($runState.Drain() | ForEach-Object {$_.Message}) -join '; ') }
$runEvents = $runState.Drain()
$jobEvents = @($runEvents | Where-Object Kind -eq 'job' | ForEach-Object { $_.Message | ConvertFrom-Json })
if ($jobEvents.Count -ne 7 -or $jobEvents[0].text -cne $firstJob.text -or $jobEvents[0].voice -ne 'hallensprecherin' -or $jobEvents[-1].phase -ne 'failed' -or $jobEvents[-1].id -ne ('b' * 32)) { throw 'Structured agent messages were not passed to the UI' }
if (($runEvents.Message -join '').Contains('must-not-be-shown')) { throw 'Lease leaked into local status/log events' }
if (-not (($runEvents.Message -join '').Contains('Generierung wird fortgesetzt'))) { throw 'Malformed display event was not handled' }
$budget = Get-Content ${psQuote(path.join(directory, 'budget.json'))} -Raw | ConvertFrom-Json
if ($budget.threads -ne 1 -or $budget.memory -ne 3072) { throw 'Local resource choice was not passed to agent' }

function Test-SetupFlow([int]$ExitCode, [bool]$Ready, [string]$Expected, [bool]$Cancel = $false) {
    $fixtureRoot = ${psQuote(directory)}
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'needs-setup'), 'pending')
    foreach ($name in @('setup-ready','install-called')) { Remove-Item (Join-Path $fixtureRoot $name) -ErrorAction SilentlyContinue }
    $state = [BtsHelperState]::new()
    $runner = [PowerShell]::Create()
    $setupScript = {
        param($root, $state, $fixtureRoot, $exitCode, $ready)
        $global:btsFixtureSetupRoot = $fixtureRoot
        $global:btsFixtureInstallerExit = $exitCode
        $global:btsFixtureReady = $ready
        function Get-CimInstance { return [PSCustomObject]@{ FreePhysicalMemory = 48GB } }
        function Start-Process {
            param($FilePath, $Verb, $WindowStyle, [switch]$PassThru, [switch]$Wait, $ArgumentList)
            if ($Verb -ne 'RunAs' -or $WindowStyle -ne 'Normal' -or -not (($ArgumentList -join ' ').Contains('--no-distribution'))) { throw 'Wrong installer contract' }
            [IO.File]::WriteAllText((Join-Path $global:btsFixtureSetupRoot 'install-called'), 'accepted')
            if ($global:btsFixtureReady) { [IO.File]::WriteAllText((Join-Path $global:btsFixtureSetupRoot 'setup-ready'), 'ready') }
            return [PSCustomObject]@{ ExitCode = $global:btsFixtureInstallerExit }
        }
        & (Join-Path $root 'Worker.ps1') -State $state -PackageRoot $root -Threads 1 -MemoryMiB 3072
    }
    $null = $runner.AddScript($setupScript.ToString()).AddArgument(${psQuote(packageDir)}).AddArgument($state).AddArgument($fixtureRoot).AddArgument($ExitCode).AddArgument($Ready)
    $pending = $runner.BeginInvoke()
    $until = [DateTime]::UtcNow.AddSeconds(10)
    $events = [Collections.Generic.List[object]]::new()
    while ([DateTime]::UtcNow -lt $until) {
        foreach ($event in $state.Drain()) { $events.Add($event) }
        if ($events.Kind -contains 'setup') { break }
        if ($pending.IsCompleted) { break }
        Start-Sleep -Milliseconds 50
    }
    if ($events.Kind -notcontains 'setup') { throw ('Missing installer consent stage: ' + (($events | ForEach-Object {$_.Message}) -join '; ')) }
    if (Test-Path (Join-Path $fixtureRoot 'install-called')) { throw 'Installer ran before consent' }
    if ($Cancel) { $state.Cancelled = $true } else { $state.InstallDecision = 1 }
    if (-not $pending.AsyncWaitHandle.WaitOne(10000)) { $state.Cancelled = $true; throw 'Installer flow hung' }
    $runner.EndInvoke($pending) | Out-Null
    foreach ($event in $state.Drain()) { $events.Add($event) }
    $runner.Dispose()
    if ($events.Kind -notcontains $Expected) { throw ('Missing ' + $Expected + ': ' + (($events | ForEach-Object {$_.Message}) -join '; ')) }
    if ($Expected -eq 'ready' -and $state.ExitCode -ne 0) { throw 'Successful install failed to continue' }
    if ($Expected -eq 'error' -and $state.ExitCode -ne 1) { throw 'Installer error was hidden' }
    if ($Cancel -and (Test-Path (Join-Path $fixtureRoot 'install-called'))) { throw 'Cancelled user decision ran installer' }
    Remove-Item (Join-Path $fixtureRoot 'needs-setup') -ErrorAction SilentlyContinue
}
Test-SetupFlow 0 $true 'ready'
Test-SetupFlow 3010 $false 'restart_required'
Test-SetupFlow 0 $false 'setup_pending'
Test-SetupFlow 5 $false 'error'
Test-SetupFlow 0 $false 'stopped' $true

function Get-ChildItem { return [PSCustomObject]@{ PSPath = 'fixture-registry' } }
$global:btsFixtureBasePath = '/unrelated'
$global:btsFixtureDistribution = $plan.Distribution
function Get-ItemProperty { return [PSCustomObject]@{ DistributionName = $global:btsFixtureDistribution; BasePath = $global:btsFixtureBasePath } }
$removeState = [BtsHelperState]::new()
& ${psQuote(path.join(packageDir, 'Worker.ps1'))} -State $removeState -PackageRoot ${psQuote(packageDir)} -Mode Remove
if ($removeState.ExitCode -ne 1 -or -not (Test-Path -LiteralPath $plan.Root)) { throw ('Removal did not protect an unrelated distribution path: ' + (($removeState.Drain() | ForEach-Object {$_.Message}) -join '; ')) }
$global:btsFixtureBasePath = Join-Path $plan.Root $plan.Distribution
$removeState = [BtsHelperState]::new()
& ${psQuote(path.join(packageDir, 'Worker.ps1'))} -State $removeState -PackageRoot ${psQuote(packageDir)} -Mode Remove
if ($removeState.ExitCode -ne 0 -or (Test-Path -LiteralPath $plan.Root)) { throw (($removeState.Drain() | ForEach-Object {$_.Message}) -join '; ') }
`);
    await fs.mkdir(path.join(directory, 'own-cache')); await fs.mkdir(path.join(directory, 'unrelated'));
    await fs.writeFile(path.join(directory, 'unrelated', 'keep.txt'), 'keep');
    await fs.symlink(path.join(directory, 'unrelated'), path.join(directory, 'own-cache', 'junction'));
    try {
        await new Promise((resolve, reject) => {
            const child = spawn(executable, ['-NoLogo', '-NoProfile', '-File', script], { stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, PATH: binaries + path.delimiter + process.env.PATH, BTS_HELPER_FIXTURE_ROOT: directory,
                    XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_DATA_HOME: path.join(directory, 'share') } });
            let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
            child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(output)));
        });
        assert.strictEqual(requests.length, 4, 'An invalid TLS certificate must not receive credentials');
        assert.strictEqual(requests[1].range, 'bytes=1024-');
        assert((await fs.readFile(path.join(directory, 'runtime.partial'))).equals(bytes));
        assert.strictEqual(await fs.readFile(path.join(directory, 'unrelated', 'keep.txt'), 'utf8'), 'keep');
        console.log('Bestanden: EXE-Paket, Integritaet, Entpacken und Aufraeumen' + (signer ? ' einschliesslich echter Test-Authenticode-Signaturen' : '') + '; Auftragsanzeige, Ressourcenwahl, WSL, Download/TLS und Entfernung.');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (require.main === module) main(process.argv[2] || 'pwsh', process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
