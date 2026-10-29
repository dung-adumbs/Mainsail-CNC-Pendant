param([string]$MachineAddress='', [ValidateSet('Brave','Chrome','Edge')][string]$Browser='Brave', [switch]$DryRun)
$ErrorActionPreference='Stop'
$files=@('CNC-Pendant.exe','CNC-Pendant.ico','README.md','build.json')
$sums=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256SUMS.txt')) {
 if($line -match '^([a-f0-9]{64})  ([^/\\]+)$'){$sums[$Matches[2]]=$Matches[1]}
}
foreach($file in $files){
 $actual=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file) -Algorithm SHA256).Hash.ToLower()
 if($actual -ne $sums[$file]){throw "Package checksum mismatch: $file"}
}
$destination=Join-Path $env:LOCALAPPDATA 'Programs\MainsailCNCPendant'
$data=Join-Path $env:LOCALAPPDATA 'MainsailCNCPendant'
$settings=Join-Path $data 'settings.xml'
$desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'CNC Pendant.lnk'
$start=Join-Path ([Environment]::GetFolderPath('Programs')) 'CNC Pendant'
$links=@($desktop,(Join-Path $start 'CNC Pendant.lnk'),(Join-Path $start 'CNC Pendant Settings.lnk'),(Join-Path $start 'Mainsail Dashboard.lnk'))
$newSettings=$null
if(!(Test-Path -LiteralPath $settings)) {
 if(!$MachineAddress){throw 'Supply -MachineAddress for the first installation.'}
 if($MachineAddress -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://'){$MachineAddress='http://'+$MachineAddress}
 $uri=[Uri]$MachineAddress
 if(!$uri.IsAbsoluteUri -or $uri.Scheme -notin @('http','https') -or !$uri.Host -or $uri.UserInfo -or $uri.Port -le 0 -or $MachineAddress -match '[\x00-\x20"\\]'){throw 'Invalid machine address'}
 $address=$uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
 $newSettings=New-Object Xml.XmlDocument
 $newSettings.LoadXml('<Preferences><Address/><Browser/><Fullscreen>true</Fullscreen><Dashboard>false</Dashboard></Preferences>')
 $newSettings.Preferences.Address=$address
 $newSettings.Preferences.Browser=$Browser
}
if($DryRun){[ordered]@{state='dry-run';destination=$destination;files=$files;settings=$settings;createSettings=($null -ne $newSettings);shortcuts=$links;machineChanges=$false} | ConvertTo-Json -Depth 4;return}
$backup=Join-Path $data ('Backups\'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$before=@()
$targets=@($files | ForEach-Object {Join-Path $destination $_})+@($settings)+$links
foreach($target in $targets){
 if(Test-Path -LiteralPath $target){
  $saved=Join-Path $backup ('before-'+$before.Count+'-'+[IO.Path]::GetFileName($target))
  Copy-Item -LiteralPath $target -Destination $saved
  $hash=(Get-FileHash -LiteralPath $target).Hash
  if((Get-FileHash -LiteralPath $saved).Hash -ne $hash){throw 'Backup checksum mismatch'}
  $before+=@{originalPath=$target;backupPath=$saved;sha256=$hash}
 }
}
@{before=$before;plannedFiles=$targets;build=(Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'build.json') | ConvertFrom-Json)} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $backup 'manifest.json')
New-Item -ItemType Directory -Force -Path $destination,$start,$data | Out-Null
foreach($file in $files){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $destination $file)
 if((Get-FileHash -LiteralPath (Join-Path $destination $file)).Hash.ToLower() -ne $sums[$file]){throw 'Installed checksum mismatch'}
}
if($newSettings){$newSettings.Save($settings)}
$shell=New-Object -ComObject WScript.Shell
for($i=0;$i -lt $links.Count;$i++){
 $link=$shell.CreateShortcut($links[$i]);$link.TargetPath=Join-Path $destination 'CNC-Pendant.exe'
 $link.WorkingDirectory=$destination;$link.IconLocation=(Join-Path $destination 'CNC-Pendant.ico')+',0'
 $link.Description='CNC Pendant — dedicated browser app session'
 $link.Arguments=if($i -eq 2){'--configure'}elseif($i -eq 3){'--dashboard'}else{''}
 $link.Save()
 if($shell.CreateShortcut($links[$i]).TargetPath -ne $link.TargetPath){throw 'Shortcut readback mismatch'}
}
[ordered]@{state='installed';destination=$destination;backup=$backup;shortcuts=$links;settings=$settings;machineChanges=$false} | ConvertTo-Json -Depth 4
