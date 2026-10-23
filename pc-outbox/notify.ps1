param([string]$Title, [string]$Message)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notice = New-Object System.Windows.Forms.NotifyIcon
$notice.Icon = [System.Drawing.SystemIcons]::Information
$notice.Text = 'CNC Outbox'
$notice.Visible = $true
$notice.ShowBalloonTip(10000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 12
$notice.Dispose()
