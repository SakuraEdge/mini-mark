param([string]$Iscc)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Copy-Item -LiteralPath LICENSE -Destination release/MiniMark/LICENSE-MiniMark.txt
Copy-Item -LiteralPath THIRD_PARTY_NOTICES.txt -Destination release/MiniMark/THIRD_PARTY_NOTICES.txt
$webview = Join-Path $env:USERPROFILE '.nuget/packages/microsoft.web.webview2/1.0.4314.35'
Copy-Item -LiteralPath (Join-Path $webview 'LICENSE.txt') -Destination release/MiniMark/LICENSE-WebView2.txt
Copy-Item -LiteralPath (Join-Path $webview 'NOTICE.txt') -Destination release/MiniMark/NOTICE-WebView2.txt
$publishRoot = (Resolve-Path release/MiniMark).Path
$manifest = @(Get-ChildItem -LiteralPath $publishRoot -File -Recurse |
  Where-Object Name -ne 'installed-files.txt' |
  ForEach-Object {
    $relative = [System.IO.Path]::GetRelativePath($publishRoot, $_.FullName)
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '|' + $relative
  })
[System.IO.File]::WriteAllLines((Join-Path $publishRoot 'installed-files.txt'), $manifest, [System.Text.UTF8Encoding]::new($false))
if(-not $Iscc) { $Iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
if(-not (Test-Path -LiteralPath $Iscc)) { throw 'Inno Setup compiler unavailable' }
& $Iscc "/DAppVersion=$version" installer/Moye.iss
if($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
Compress-Archive -LiteralPath release/MiniMark -DestinationPath "release/MiniMark-$version-windows-x64.zip" -CompressionLevel Optimal -Force
