param([Parameter(Mandatory)][string]$PythonwPath,[string]$MachineAddress='', [switch]$DryRun)
$ErrorActionPreference='Stop'
$PythonwPath=(Resolve-Path -LiteralPath $PythonwPath).ProviderPath
if(!(Test-Path -LiteralPath $PythonwPath) -or [IO.Path]::GetFileName($PythonwPath) -ne 'pythonw.exe'){throw 'Choose an installed pythonw.exe runtime.'}
$destination=Join-Path $env:LOCALAPPDATA 'Programs\MainsailCNCPendant\BrowserShell'
$data=Join-Path $env:LOCALAPPDATA 'MainsailCNCPendant'
$config=Join-Path $data 'pc-settings.json'
$names=@('browser_app.py','browser-app.html','browser-app.js','icon.svg','icon.ico')
$hashes=@{};foreach($name in $names){$hashes[$name]=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name)).Hash}
$start=Join-Path ([Environment]::GetFolderPath('Programs')) 'CNC Pendant'
$links=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'CNC Pendant.lnk'),(Join-Path $start 'CNC Pendant.lnk'))
$new=$null
if(!(Test-Path -LiteralPath $config)){
 if(!$MachineAddress){throw 'Supply the initial machine address.'}
 if($MachineAddress -notmatch '://'){$MachineAddress='http://'+$MachineAddress}
 $uri=[Uri]$MachineAddress
 if(!$uri.IsAbsoluteUri -or $uri.Scheme -notin @('http','https') -or !$uri.Host -or $uri.UserInfo -or $uri.Port -le 0 -or $MachineAddress -match '[\x00-\x20"\\]'){throw 'Invalid machine address'}
 $new=@{address=$uri.GetLeftPart([UriPartial]::Authority).TrimEnd('/');layout='compact';fit=$true;awake=$true;fullscreen=$false}
}
if($DryRun){@{state='dry-run';destination=$destination;pythonw=$PythonwPath;files=$names;hashes=$hashes;shortcuts=$links;config=$config;createSettings=($null -ne $new)} | ConvertTo-Json -Depth 5;return}
$backup=Join-Path $data ('Backups\browser-shell-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$before=@();$targets=@($names | ForEach-Object {Join-Path $destination $_})+@($config)+$links
foreach($target in $targets){if(Test-Path -LiteralPath $target){$saved=Join-Path $backup ('before-'+$before.Count+'-'+[IO.Path]::GetFileName($target));Copy-Item -LiteralPath $target -Destination $saved;$hash=(Get-FileHash -LiteralPath $target).Hash;if((Get-FileHash -LiteralPath $saved).Hash -ne $hash){throw 'Backup mismatch'};$before+=@{path=$target;sha256=$hash;saved=$saved}}}
@{before=$before;planned=$targets;proposed=$hashes;sourceCommit=(git -C $PSScriptRoot rev-parse HEAD)} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $backup 'manifest.json')
New-Item -ItemType Directory -Force -Path $destination,$data,$start | Out-Null
foreach($name in $names){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destination $name);if((Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash -ne $hashes[$name]){throw 'Installed hash mismatch'}}
if($new){$new | ConvertTo-Json | Set-Content -Encoding ascii $config}
$shell=New-Object -ComObject WScript.Shell
foreach($path in $links){$link=$shell.CreateShortcut($path);$link.TargetPath=$PythonwPath;$link.Arguments='"'+(Join-Path $destination 'browser_app.py')+'"';$link.WorkingDirectory=$destination;$icon=Join-Path (Split-Path $destination -Parent) 'CNC-Pendant.ico';if(Test-Path -LiteralPath $icon){$link.IconLocation=$icon+',0'};$link.Description='CNC Pendant — saved PC settings and dedicated Brave session';$link.Save();if($shell.CreateShortcut($path).TargetPath -ne $PythonwPath){throw 'Shortcut mismatch'}}
@{state='installed';destination=$destination;config=$config;backup=$backup;shortcuts=$links;hashes=$hashes} | ConvertTo-Json -Depth 5
