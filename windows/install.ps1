# Installs Lumen from the zip (the GitHub installer, Lumen-Setup-<version>.exe, does the same job by itself).
# Double-click "Install Lumen.cmd" next to this folder. No admin rights or Node.js needed.
#   -Update  used by Lumen's own updater: waits for Lumen to close, then reopens it
#   -Quiet   no questions, no window
param([switch]$Quiet, [switch]$Update)
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$src = Join-Path (Split-Path -Parent $here) 'Lumen'
if (-not (Test-Path -LiteralPath (Join-Path $src 'Lumen.exe'))) { $src = Join-Path $here 'Lumen' }
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Lumen'
$exe = Join-Path $dest 'Lumen.exe'

function Say([string]$t, [string]$c = 'White') { if (-not $Quiet) { Write-Host "  $t" -ForegroundColor $c } }
function Ask([string]$q) { if ($Quiet) { return $true }; $a = Read-Host "    $q [Y/n]"; return ($a -eq '' -or $a -match '^[yY]') }

if (-not (Test-Path -LiteralPath (Join-Path $src 'Lumen.exe'))) { Say 'Lumen.exe was not found next to this installer. Unzip the whole download first.' 'Red'; if (-not $Quiet) { Read-Host '  Press Enter to close' | Out-Null }; exit 1 }
$version = (Get-Content -Raw -LiteralPath (Join-Path $src 'resources\app\package.json') | ConvertFrom-Json).version

Say ''
Say "Lumen $version — Install"

# 1 · close Lumen if it's open (the updater has already asked it to close; give it a moment to save)
for ($i = 0; $i -lt 50; $i++) {
  $running = Get-Process -Name 'Lumen' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, 'OrdinalIgnoreCase') }
  if (-not $running) { break }
  if ($i -eq 30) { $running | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 200
}

# 2 · the older, folder-based Lumen (1.x): stop it and find its folder, so the app can bring its settings over
$oldRoot = $null; $oldAutostart = $false
$wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$startupLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Lumen.lnk'
foreach ($l in @((Join-Path $desktop 'Lumen.lnk'), (Join-Path $programs 'Lumen\Lumen.lnk'), $startupLnk)) {
  if (-not (Test-Path -LiteralPath $l)) { continue }
  try {
    $s = $wsh.CreateShortcut($l)
    if ($s.Arguments -match '"?(.+?)\\windows\\Start Lumen\.vbs"?') {
      if (-not $oldRoot) { $oldRoot = $Matches[1] }
      if ($l -eq $startupLnk) { $oldAutostart = $true; Remove-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}
if ($oldRoot) {
  Say "Found the older Lumen in $oldRoot — your settings will be copied over (the old folder is left as it is)." 'Gray'
  $stop = Join-Path $oldRoot 'windows\start-lumen.ps1'
  if (Test-Path -LiteralPath $stop) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $stop -stop | Out-Null }
  foreach ($old in @((Join-Path $desktop 'Update Lumen.lnk'), (Join-Path $programs 'Lumen\Update Lumen.lnk'), (Join-Path $programs 'Lumen\Stop Lumen.lnk'))) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
}

# 3 · copy the program
Say 'Copying Lumen…'
try { Get-ChildItem -LiteralPath $src -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch {}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
& robocopy.exe $src $dest /MIR /NFL /NDL /NJH /NJS /NP /R:3 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Say 'Some files could not be copied. Close Lumen and try again.' 'Red'; if (-not $Quiet) { Read-Host '  Press Enter to close' | Out-Null }; exit 1 }
Copy-Item -LiteralPath (Join-Path $here 'uninstall.ps1') -Destination (Join-Path $dest 'uninstall.ps1') -Force -ErrorAction SilentlyContinue

# the Lumen icon and name on the program itself (taskbar, Task Manager)
$rcedit = Join-Path $here 'rcedit-x64.exe'
$ico = Join-Path $dest 'resources\app\build\icon.ico'
if ((Test-Path -LiteralPath $rcedit) -and (Test-Path -LiteralPath $ico)) {
  & $rcedit $exe --set-icon $ico --set-version-string ProductName Lumen --set-version-string FileDescription Lumen --set-version-string CompanyName Lumen --set-version-string OriginalFilename Lumen.exe --set-file-version $version --set-product-version $version 2>$null | Out-Null
}

# 4 · shortcuts
function Link([string]$path) {
  $s = $wsh.CreateShortcut($path); $s.TargetPath = $exe; $s.WorkingDirectory = $dest
  $s.IconLocation = "$exe,0"; $s.Description = 'Lumen — TV interface'; $s.Save()
}
if (Test-Path -LiteralPath (Join-Path $programs 'Lumen') -PathType Container) {
  # the older Lumen kept a folder of shortcuts in the Start menu; one shortcut is enough now
  Remove-Item -LiteralPath (Join-Path $programs 'Lumen') -Recurse -Force -ErrorAction SilentlyContinue
}
Link (Join-Path $programs 'Lumen.lnk')
if (-not $Update) { Link (Join-Path $desktop 'Lumen.lnk') }
elseif (Test-Path -LiteralPath (Join-Path $desktop 'Lumen.lnk')) { Link (Join-Path $desktop 'Lumen.lnk') }

# 5 · listed in Settings › Apps, so it can be removed like any other program
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumen'
New-Item -Path $key -Force | Out-Null
$size = [int]((Get-ChildItem -LiteralPath $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
$props = @{ DisplayName = 'Lumen'; DisplayVersion = $version; Publisher = 'Lumen'; DisplayIcon = "$exe,0"; InstallLocation = $dest
  UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""; NoModify = 1; NoRepair = 1; EstimatedSize = $size }
foreach ($k in $props.Keys) { $t = if ($props[$k] -is [int]) { 'DWord' } else { 'String' }; New-ItemProperty -Path $key -Name $k -Value $props[$k] -PropertyType $t -Force | Out-Null }

# 6 · let phones on your home network reach the remote (Windows asks for permission once)
if (-not $Update) {
  $rule = & netsh advfirewall firewall show rule name="Lumen" 2>$null
  if (-not ($rule -match 'Lumen')) {
    Say 'Windows will ask for permission to let your phone connect to Lumen (home networks only).' 'Gray'
    try {
      Start-Process -FilePath 'netsh.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "advfirewall firewall add rule name=`"Lumen`" dir=in action=allow program=`"$exe`" enable=yes profile=private"
    } catch { Say 'Skipped. If your phone can''t connect, run Install Lumen again and allow it.' 'Gray' }
  }
}

# 7 · open Lumen
$launch = @()
if ($oldRoot) { $launch += "`"--old-root=$oldRoot`"" }
if ($oldAutostart) { $launch += '--enable-autostart' }
elseif (-not $Update -and -not $Quiet -and -not $oldRoot) { if (Ask 'Start Lumen automatically when you sign in to this PC?') { $launch += '--enable-autostart' } }
if ($launch.Count) { Start-Process -FilePath $exe -ArgumentList ($launch -join ' ') } else { Start-Process -FilePath $exe }
Say "Lumen $version is installed and opening." 'Green'
if (-not $Quiet) { Say 'You can delete the downloaded zip now.' 'Gray'; Start-Sleep -Seconds 3 }
