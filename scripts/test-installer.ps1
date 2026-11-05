$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$target = Join-Path $env:RUNNER_TEMP 'Moye-install-test'
$choices = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.yaml\UserChoice',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.yml\UserChoice'
)
function Read-Choices {
  return ($choices | ForEach-Object {
    if(Test-Path $_) { (Get-ItemProperty $_ | Select-Object ProgId,Hash | ConvertTo-Json -Compress) } else { '' }
  }) -join "`n"
}
$before = Read-Choices
$installer = (Resolve-Path "release/MiniMark-Setup-$version-windows-x64.exe").Path
$arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=defaultmd,defaultyaml,desktopicon',("/DIR=`"$target`""))
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)" }
if(-not (Test-Path -LiteralPath (Join-Path $target 'MiniMark.exe'))) { throw 'Installed application missing' }
$command = (Get-Item 'HKCU:\Software\Classes\Moye.Markdown\shell\open\command').GetValue('')
if($command -ne ('"' + (Join-Path $target 'MiniMark.exe') + '" "%1"')) { throw 'Open command does not quote paths correctly' }
$capability = Get-ItemProperty 'HKCU:\Software\Moye\Capabilities\FileAssociations'
if($capability.'.md' -ne 'Moye.Markdown') { throw 'MD capability was not registered' }
if($capability.'.yaml' -ne 'Moye.Yaml' -or $capability.'.yml' -ne 'Moye.Yaml') { throw 'YAML capability was not registered' }
if((Read-Choices) -ne $before) { throw 'Installer changed protected default choice' }
$yamlCommand = (Get-Item 'HKCU:\Software\Classes\Moye.Yaml\shell\open\command').GetValue('')
if($yamlCommand -ne ('"' + (Join-Path $target 'MiniMark.exe') + '" "%1"')) { throw 'YAML open command does not quote paths correctly' }
$shell = New-Object -ComObject WScript.Shell
function Normalize-ShortcutPath([string]$path) {
  if([string]::IsNullOrWhiteSpace($path)) { return '' }
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($path)).TrimEnd('\','/')
}
foreach($link in @((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Mini Mark.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Mini Mark/Mini Mark.lnk'))) {
  if(-not (Test-Path -LiteralPath $link)) { throw "Missing shortcut: $link" }
  # WSH cannot load filenames outside the system ANSI code page; inspect identical bytes under an ASCII name.
  $readableLink = Join-Path $env:RUNNER_TEMP 'moye-shortcut-check.lnk'
  Copy-Item -LiteralPath $link -Destination $readableLink -Force
  if((Get-FileHash -LiteralPath $link).Hash -ne (Get-FileHash -LiteralPath $readableLink).Hash) { throw 'Shortcut verification copy differs' }
  $shortcut = $shell.CreateShortcut($readableLink)
  if((Normalize-ShortcutPath $shortcut.TargetPath) -ne (Normalize-ShortcutPath (Join-Path $target 'MiniMark.exe')) -or (Normalize-ShortcutPath $shortcut.WorkingDirectory) -ne (Normalize-ShortcutPath $target)) {
    throw "Shortcut points outside installation: target=$($shortcut.TargetPath); working=$($shortcut.WorkingDirectory); expected=$target"
  }
}
# Model an older release, a user-modified file, and malicious manifest entries.
$owned = Join-Path $target 'installed-files.txt'
function Add-OldFile([string]$relative, [string]$content) {
  $file = Join-Path $target $relative
  New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
  [IO.File]::WriteAllText($file, $content)
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::AppendAllText($owned, "$hash|$relative`n")
}
Add-OldFile 'wwwroot\old-unused.js' 'old code'
Add-OldFile 'changed.txt' 'original'
[IO.File]::WriteAllText((Join-Path $target 'changed.txt'), 'user changes')
Add-OldFile 'Data\session-v2.json' 'user session'
Add-OldFile 'Source\notes.md' 'source notes'
Add-OldFile 'Backups\notes.md' 'saved notes'
$outside = Join-Path $env:RUNNER_TEMP 'Moye-outside-test'
New-Item -ItemType Directory -Path $outside -Force | Out-Null
$outsideFile = Join-Path $outside 'keep.txt'
[IO.File]::WriteAllText($outsideFile, 'outside installation')
$outsideHash = (Get-FileHash -LiteralPath $outsideFile).Hash
New-Item -ItemType Junction -Path (Join-Path $target 'linked') -Target $outside | Out-Null
[IO.File]::AppendAllText($owned, "$outsideHash|linked\keep.txt`n$outsideHash|..\Moye-outside-test\keep.txt`n")
$process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0) { throw "Upgrade exited $($process.ExitCode)" }
if(Test-Path -LiteralPath (Join-Path $target 'wwwroot/old-unused.js')) { throw 'Obsolete owned file survived upgrade' }
if([IO.File]::ReadAllText((Join-Path $target 'changed.txt')) -ne 'user changes') { throw 'Upgrade removed user modifications' }
foreach($file in @('Data/session-v2.json','Source/notes.md','Backups/notes.md')) {
  if(-not (Test-Path -LiteralPath (Join-Path $target $file))) { throw "Protected data removed: $file" }
}
if((Get-FileHash -LiteralPath $outsideFile).Hash -ne $outsideHash) { throw 'Upgrade followed a junction or traversal' }
if((Read-Choices) -ne $before) { throw 'Upgrade changed protected default choice' }
$uninstaller = Join-Path $target 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0) { throw "Uninstaller exited $($process.ExitCode)" }
if(Test-Path 'HKCU:\Software\Classes\Moye.Markdown') { throw 'Owned ProgID was not removed' }
if(Test-Path 'HKCU:\Software\Classes\Moye.Yaml') { throw 'YAML ProgID was not removed' }
if((Read-Choices) -ne $before) { throw 'Uninstaller changed protected default choice' }
if(-not (Test-Path -LiteralPath (Join-Path $target 'Data/session-v2.json'))) { throw 'Uninstall removed user data' }
Write-Output 'PASS Windows install, in-place upgrade, obsolete-file cleanup, data/junction protection, shortcuts, default choice and uninstall'
