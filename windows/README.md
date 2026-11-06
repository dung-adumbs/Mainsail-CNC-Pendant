# CNC Pendant for Windows

A small launcher opens Pendant in a dedicated Brave, Chrome or Edge app window.
The browser profile is separate from ordinary browser sessions. Mainsail remains
available through Pendant's Dashboard button and left navigation, including its
native files, console, history, configuration and other pages.

Use **CNC Pendant** on the desktop or Start menu. **F11** leaves or enters full
screen; **Alt+Left / Alt+Right** navigate; **Ctrl+R** reloads; **Alt+F4** closes the
window. The browser app menu remains available when out of full screen.

Open **CNC Pendant Settings** in Start to change the machine address, browser,
full-screen launch or whether to open the expanded dashboard. Settings take effect
when opening a new app window. Close the old dedicated app window first.

The launcher sends no CNC commands. The live Pendant and native Mainsail pages
retain their normal functionality. Closing the window does not stop a machine job.
The Pi and network connection are still required. This is not an offline controller.

## Install and build

The lightweight browser shell is the recommended tester path when Python is
already installed. Run the following first as a dry run, review the paths and
hashes, then repeat without `-DryRun`:

```powershell
.\Install-BrowserShell.ps1 `
  -PythonwPath "C:\Path\To\Python\pythonw.exe" `
  -MachineAddress "http://your-machine-address" `
  -DryRun
```

`Install.ps1 -MachineAddress http://your-machine-address -DryRun` installs the
compiled .NET launcher alternative. It likewise installs for the current Windows
user, verifies package checksums, preserves previous installed files and settings,
and creates Desktop/Start shortcuts. No administrator account, browser extension
or controller restart is required. An installed supported browser is required.

Build from source with `Build.ps1 -OutputDirectory <new output folder>` using the
Windows .NET Framework compiler. The icon is generated from the existing Pendant
crosshair design; no external application runtime is downloaded or bundled.

Private settings: `%LOCALAPPDATA%\MainsailCNCPendant\settings.xml`.
Dedicated profiles: `%LOCALAPPDATA%\MainsailCNCPendant\BrowserProfile\<browser>`.
The separate profile initially has no ordinary browser logins or local-only
Pendant preferences. Shared machine preferences still load from Moonraker.
Router assumptions/chip-load targets are session-specific and may need review.

To remove the launcher, close only its dedicated windows and remove its installed
folder and shortcuts. Preserve the profile/settings for later use, or archive
them separately. Do not remove normal Brave/Chrome/Edge profiles.
