param(
    [Parameter(Mandatory=$true)][string]$Python,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [Parameter(Mandatory=$true)][string]$Outbox,
    [Parameter(Mandatory=$true)][string]$Sent,
    [string]$Server = 'http://192.168.1.158',
    [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$pythonWindowless = Join-Path (Split-Path $Python) 'pythonw.exe'
if (!(Test-Path -LiteralPath $pythonWindowless)) { throw 'Python installation must include pythonw.exe.' }
New-Item -ItemType Directory -Force -Path $InstallDir,$Outbox,$Sent | Out-Null
foreach ($name in @('outbox_helper.py','status_window.py','notify.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $InstallDir $name) -Force
}
$configPath = Join-Path $InstallDir 'config.json'
if (!(Test-Path -LiteralPath $configPath)) {
    @{server=$Server;outbox=$Outbox;sent=$Sent;inbox='Inbox';settle_seconds=10;poll_seconds=3;lock_port=47831} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
}
$shell = New-Object -ComObject WScript.Shell
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'CNC Outbox Helper.lnk'
$shortcut = $shell.CreateShortcut($startupPath)
$shortcut.TargetPath = $pythonWindowless
$shortcut.Arguments = '"' + (Join-Path $InstallDir 'outbox_helper.py') + '" --config "' + $configPath + '"'
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Description = 'Automatically upload finished CNC posts; verified archive, offline retry.'
$shortcut.Save()
$statusPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'CNC Outbox Status.lnk'
$status = $shell.CreateShortcut($statusPath)
$status.TargetPath = $pythonWindowless
$status.Arguments = '"' + (Join-Path $InstallDir 'status_window.py') + '"'
$status.WorkingDirectory = $InstallDir
$status.Description = 'View CNC Outbox status. Closing the window does not stop transfers.'
$status.Save()
if (!$NoStart) {
    $stopFile = Join-Path $InstallDir 'STOP'
    if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
    Start-Process -FilePath $pythonWindowless -ArgumentList $shortcut.Arguments -WindowStyle Hidden
}
Write-Output "Installed. Fusion output folder: $Outbox"
Write-Output "Verified PC archive: $Sent"
Write-Output "Status shortcut: $statusPath"
