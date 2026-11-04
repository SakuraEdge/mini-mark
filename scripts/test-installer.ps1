$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$target = Join-Path $env:RUNNER_TEMP 'Moye-install-test'
$choice = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice'
function Read-Choice {
  if(Test-Path $choice) { return (Get-ItemProperty $choice | Select-Object ProgId,Hash | ConvertTo-Json -Compress) }
  return ''
}
$before = Read-Choice
$installer = (Resolve-Path "release/Moye-Setup-$version-windows-x64.exe").Path
$arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=defaultmd',("/DIR=`"$target`""))
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)" }
if(-not (Test-Path -LiteralPath (Join-Path $target 'Moye.exe'))) { throw 'Installed application missing' }
$command = (Get-Item 'HKCU:\Software\Classes\Moye.Markdown\shell\open\command').GetValue('')
if($command -ne ('"' + (Join-Path $target 'Moye.exe') + '" "%1"')) { throw 'Open command does not quote paths correctly' }
$capability = Get-ItemProperty 'HKCU:\Software\Moye\Capabilities\FileAssociations'
if($capability.'.md' -ne 'Moye.Markdown') { throw 'MD capability was not registered' }
if((Read-Choice) -ne $before) { throw 'Installer changed protected default choice' }
$uninstaller = Join-Path $target 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0) { throw "Uninstaller exited $($process.ExitCode)" }
if(Test-Path 'HKCU:\Software\Classes\Moye.Markdown') { throw 'Owned ProgID was not removed' }
if((Read-Choice) -ne $before) { throw 'Uninstaller changed protected default choice' }
Write-Output 'PASS Windows installer, quoted file association, unchanged UserChoice, clean uninstall'
