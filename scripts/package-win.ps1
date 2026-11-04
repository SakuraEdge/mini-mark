param([string]$Iscc)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Copy-Item -LiteralPath LICENSE -Destination release/Moye/LICENSE-Moye.txt
Copy-Item -LiteralPath THIRD_PARTY_NOTICES.txt -Destination release/Moye/THIRD_PARTY_NOTICES.txt
$webview = Join-Path $env:USERPROFILE '.nuget/packages/microsoft.web.webview2/1.0.4314.35'
Copy-Item -LiteralPath (Join-Path $webview 'LICENSE.txt') -Destination release/Moye/LICENSE-WebView2.txt
Copy-Item -LiteralPath (Join-Path $webview 'NOTICE.txt') -Destination release/Moye/NOTICE-WebView2.txt
if(-not $Iscc) { $Iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
if(-not (Test-Path -LiteralPath $Iscc)) { throw 'Inno Setup compiler unavailable' }
if(-not (Test-Path -LiteralPath installer/ChineseSimplified.isl)) {
  Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/Unofficial/ChineseSimplified.isl' -OutFile installer/ChineseSimplified.isl
}
& $Iscc "/DAppVersion=$version" installer/Moye.iss
if($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
Compress-Archive -LiteralPath release/Moye -DestinationPath "release/Moye-$version-windows-x64.zip" -CompressionLevel Optimal -Force
