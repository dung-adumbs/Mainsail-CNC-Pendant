param([string]$OutputDirectory=(Join-Path $PSScriptRoot 'build'))
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Drawing
$iconPath=Join-Path $OutputDirectory 'CNC-Pendant.ico'
$bitmap=New-Object Drawing.Bitmap 108,108
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#192b36'))
$blue=New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#4ba9df'))
foreach($rectangle in @(@(48,12,12,28),@(48,68,12,28),@(12,48,28,12),@(68,48,28,12))) {
 $graphics.FillRectangle($blue,$rectangle[0],$rectangle[1],$rectangle[2],$rectangle[3])
}
$graphics.FillRectangle([Drawing.Brushes]::White,44,44,20,20)
$icon=[Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream=[IO.File]::Create($iconPath);$icon.Save($stream);$stream.Dispose()
$graphics.Dispose();$bitmap.Dispose();$blue.Dispose()
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Xml.dll /r:System.Core.dll "/win32icon:$iconPath" "/out:$OutputDirectory\CNC-Pendant.exe" (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE){throw 'Build failed'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1') -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $OutputDirectory
@{version='0.1.0';launcherSourceSHA256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'Launcher.cs')).Hash;sourceCommit=(git -C $PSScriptRoot rev-parse HEAD)} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'build.json')
Get-ChildItem -LiteralPath $OutputDirectory -File | Where-Object Name -ne SHA256SUMS.txt | ForEach-Object {
 '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower(),$_.Name
} | Set-Content -Encoding ascii (Join-Path $OutputDirectory 'SHA256SUMS.txt')
