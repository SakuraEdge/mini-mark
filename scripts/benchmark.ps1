param(
    [Parameter(Mandatory=$true)][string]$Exe,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [int]$Runs = 5
)
$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path -LiteralPath $Exe).Path
$directory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$results = @()
for ($i = 1; $i -le $Runs; $i++) {
    $diagnostic = Join-Path $directory "run-$i.json"
    if (Test-Path -LiteralPath $diagnostic) { throw 'Use a fresh output directory to avoid stale measurements.' }
    $info = [Diagnostics.ProcessStartInfo]::new($exePath, '--benchmark')
    $info.UseShellExecute = $false
    $info.Environment['MOYE_DATA_DIR'] = Join-Path $directory 'profile'
    $info.Environment['MOYE_DIAGNOSTICS_PATH'] = $diagnostic
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($info)
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (!(Test-Path -LiteralPath $diagnostic) -and [DateTime]::UtcNow -lt $deadline -and !$process.HasExited) {
        Start-Sleep -Milliseconds 20
    }
    $wall = $clock.Elapsed.TotalMilliseconds
    if (!(Test-Path -LiteralPath $diagnostic)) {
        if (!$process.HasExited) { $process.Kill() }
        throw "Startup did not complete in run $i"
    }
    if (!$process.WaitForExit(5000)) { $process.Kill(); throw 'Benchmark did not exit' }
    $data = Get-Content -LiteralPath $diagnostic -Raw | ConvertFrom-Json
    $results += [pscustomobject]@{Run=$i;FreshProfile=($i -eq 1);ProcessToReadyMs=[Math]::Round($wall,1);ManagedToReadyMs=[Math]::Round($data.startupMilliseconds,1);RendererMs=[Math]::Round($data.rendererMilliseconds,1)}
    # Wait for this run's browser to release its profile before the next launch.
    if ($i -lt $Runs -and $data.browserProcessId) {
        $engine = Get-Process -Id $data.browserProcessId -ErrorAction SilentlyContinue
        if ($engine -and !$engine.WaitForExit(15000)) { Write-Warning 'WebView2 shutdown is still pending; the next run may include profile-lock delay.' }
    }
}
$results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'results.json') -Encoding utf8
$results | Format-Table -AutoSize
