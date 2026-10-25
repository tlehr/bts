param([Parameter(Mandatory=$true)][string]$ReferenceDirectory,
      [string]$Output = (Join-Path $PSScriptRoot '../static/speech-helper/windows-launcher.bin'))
$ErrorActionPreference = 'Stop'
# PowerShell 7 already ships Roslyn. Reference assemblies come from Microsoft's
# Microsoft.NETFramework.ReferenceAssemblies.net48 1.0.3 package (build only).
Add-Type -AssemblyName Microsoft.CodeAnalysis
Add-Type -AssemblyName Microsoft.CodeAnalysis.CSharp
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../static/speech-helper/Launcher.cs'))
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($source)
$references = [Microsoft.CodeAnalysis.MetadataReference[]]@(foreach ($name in @('mscorlib.dll','System.dll','System.Core.dll','System.IO.Compression.dll','System.Windows.Forms.dll')) {
    [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile((Join-Path $ReferenceDirectory $name))
})
$options = [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::WindowsApplication)
$options = $options.WithOptimizationLevel([Microsoft.CodeAnalysis.OptimizationLevel]::Release).WithDeterministic($true)
$compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('BTS-Sprachhelfer', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), $references, $options)
$stream = [IO.File]::Create([IO.Path]::GetFullPath($Output))
try {
    $result = $compilation.Emit($stream)
    if (-not $result.Success) { throw (($result.Diagnostics | ForEach-Object { $_.ToString() }) -join "`n") }
} finally { $stream.Dispose() }
Write-Output ('Windows-Starter gebaut: ' + [IO.Path]::GetFullPath($Output))
