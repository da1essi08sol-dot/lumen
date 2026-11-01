# Removes Lumen from this PC (Settings › Apps › Lumen › Uninstall runs this).
$ErrorActionPreference = 'Continue'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Lumen'
$data = Join-Path $env:LOCALAPPDATA 'Lumen'
# run from a temporary copy, so the program folder can be removed
if ($PSScriptRoot -and $PSScriptRoot.StartsWith($dest, 'OrdinalIgnoreCase')) {
  $tmp = Join-Path $env:TEMP 'lumen-uninstall.ps1'
  Copy-Item -LiteralPath $PSCommandPath -Destination $tmp -Force
  Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tmp`""
  exit 0
}
Write-Host ''
Write-Host '  Uninstall Lumen' -ForegroundColor White
Get-Process -Name 'Lumen' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, 'OrdinalIgnoreCase') } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='brave.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($data.ToLower()) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800
Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lumen.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Lumen.lnk'))) { Remove-Item -LiteralPath $l -Force -ErrorAction SilentlyContinue }
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumen' -Recurse -Force -ErrorAction SilentlyContinue
foreach ($n in @('Lumen', 'tv.lumen.app', 'electron.app.Lumen')) { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $n -ErrorAction SilentlyContinue }
$a = Read-Host '  Also delete your Lumen settings, folders, sign-ins and Continue Watching? [y/N]'
if ($a -match '^[yY]') { Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '  Settings deleted.' -ForegroundColor Gray }
else { Write-Host "  Your settings were kept in $data (Lumen uses them again if you reinstall)." -ForegroundColor Gray }
Write-Host '  Lumen has been removed.' -ForegroundColor Green
Start-Sleep -Seconds 3
