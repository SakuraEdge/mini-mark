param(
  [Parameter(Mandatory)][string]$PublishDirectory,
  [Parameter(Mandatory)][string]$InstallDirectory
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $PublishDirectory).Path.TrimEnd('\')
$target = (Resolve-Path -LiteralPath $InstallDirectory).Path.TrimEnd('\')
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($source -eq $target -or $target.Length -lt 4) { throw 'Invalid installation directories.' }
if (-not (Test-Path -LiteralPath "$source/MiniMark.exe") -or -not (Test-Path -LiteralPath "$source/wwwroot/index.html")) { throw 'Incomplete publish directory.' }
if (-not (Test-Path -LiteralPath "$target/installed-files.txt")) { throw 'Existing ownership manifest required.' }
if (Get-Process MiniMark -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$target\MiniMark.exe" }) { throw 'Save your documents and close Mini Mark before updating.' }

function OwnedPath([string]$root, [string]$relative) {
  if ([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)|:' -or $relative -match '^(Data|Backups|Source)[\\/]' -or $relative -match '^unins') { throw "Unsafe application path: $relative" }
  $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $full.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw "Path escaped installation root: $relative" }
  $check = $full
  while ($check.Length -ge $root.Length) {
    if ((Test-Path -LiteralPath $check) -and ((Get-Item -LiteralPath $check -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Reparse point rejected: $check" }
    if ($check -eq $root) { break }
    $check = [IO.Path]::GetDirectoryName($check)
  }
  return $full
}

$old = @{}
foreach ($line in Get-Content -LiteralPath "$target/installed-files.txt") {
  if ($line -notmatch '^([a-fA-F0-9]{64})\|(.+)$') { throw 'Invalid installed ownership manifest.' }
  $old[$Matches[2]] = $Matches[1]
}
$new = @{}
$changes = [Collections.Generic.List[string]]::new()
$obsolete = [Collections.Generic.List[string]]::new()
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
  $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
  if ($relative -eq 'installed-files.txt') { continue }
  $destination = OwnedPath $target $relative
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $new[$relative] = $hash
  if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $hash) { continue }
    if (-not $old.ContainsKey($relative)) { throw "Unmanaged existing file would be overwritten: $relative" }
  }
  $changes.Add($relative)
}
foreach ($relative in $old.Keys) {
  if ($new.ContainsKey($relative)) { continue }
  $full = OwnedPath $target $relative
  if ((Test-Path -LiteralPath $full) -and (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -eq $old[$relative]) { $obsolete.Add($relative) }
}

$backup = Join-Path $repo ("release/local-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath "$target/installed-files.txt" -Destination "$backup/installed-files.txt"
$saved = [Collections.Generic.List[string]]::new()
$added = [Collections.Generic.List[string]]::new()
foreach ($relative in @($changes) + @($obsolete)) {
  $full = OwnedPath $target $relative
  if (Test-Path -LiteralPath $full) {
    $backupFile = OwnedPath $backup $relative
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($backupFile)) -Force | Out-Null
    Copy-Item -LiteralPath $full -Destination $backupFile
    $saved.Add($relative)
  } else { $added.Add($relative) }
}
try {
  if (Get-Process MiniMark -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq "$target\MiniMark.exe" }) { throw 'Mini Mark was reopened; update stopped.' }
  foreach ($relative in $changes) {
    $destination = OwnedPath $target $relative
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $destination -Force
  }
  foreach ($relative in $new.Keys) {
    if ((Get-FileHash -LiteralPath (OwnedPath $target $relative) -Algorithm SHA256).Hash -ne $new[$relative]) { throw "Installed checksum mismatch: $relative" }
  }
  foreach ($relative in $obsolete) { Remove-Item -LiteralPath (OwnedPath $target $relative) }
  $manifest = @($new.Keys | Sort-Object | ForEach-Object { "$($new[$_])|$_" })
  [IO.File]::WriteAllLines("$target/installed-files.txt", $manifest, [Text.UTF8Encoding]::new($false))
} catch {
  foreach ($relative in $saved) { Copy-Item -LiteralPath (OwnedPath $backup $relative) -Destination (OwnedPath $target $relative) -Force }
  foreach ($relative in $added) {
    $full = OwnedPath $target $relative
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full }
  }
  Copy-Item -LiteralPath "$backup/installed-files.txt" -Destination "$target/installed-files.txt" -Force
  throw
}
[pscustomobject]@{ Installed = $target; Replaced = $changes.Count; RemovedObsolete = $obsolete.Count; Verified = $new.Count; Backup = $backup } | ConvertTo-Json
