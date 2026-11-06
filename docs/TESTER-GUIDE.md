# Tester guide and executive summary

## Executive summary

Mainsail CNC Pendant is an early developer preview that adds a CNC-focused control page alongside a normal Mainsail installation. The reference machine is a V1 Engineering LowRider V4 running Klipper and Moonraker. The same live page can be used from a desktop browser, a dedicated Windows window, an Android browser, or the supplied Android wrapper.

The project adds deliberate step jogging, machine/work coordinates, unit conversion, Safe-Z and keep-out guards, file and project review, actual G-code scanning, verified Start/Resume, tool-change and requested-RPM prompts, live motion/chip-load estimates, hardware-health monitoring, and interruption records. Optional Fusion and Windows helpers create uniquely named one-tool stages and transfer them to the Pi with SHA-256 verification.

This is **not** a universal drop-in CNC conversion or certified safety system. The reference homing, pause, LEDs, dual motors and recovery behavior are machine-specific. A software E-stop still depends on the Pi, network and controller. Keep a suitable physical emergency stop, review every pin and macro, and begin with supervised motionless tests and air cuts.

For an AI-assisted adaptation, begin with [Install with ChatGPT or Codex](CHATGPT-INSTALL-STARTER.md). It contains a concise intake list and a ready-to-copy request that directs the assistant through audit, backup, staging, testing and supervised commissioning.

## What a tester should install

| Component | Required? | Purpose |
|---|---:|---|
| Pendant web assets | Yes | Phone/desktop CNC interface served by the Pi |
| Moonraker preflight components | Yes for verified Start/Resume | Scans actual G-code and checks current offsets, bounds, fingerprints and keep-outs |
| Reviewed Klipper guard/macros | Yes for verified Start/Resume | Prevents native Start/Resume from bypassing the reviewed Pendant workflow |
| Android wrapper | Optional | Dedicated full-screen phone window loading the Pi-hosted page |
| Windows browser shell | Optional | Dedicated desktop app-style window with a separate browser profile |
| Fusion post | Optional | Emits Pendant metadata and marked travel without controlling the router |
| Fusion CNC Outbox add-in | Optional | Splits selected operations at tool changes and posts ordered, uniquely named stages |
| Windows Outbox helper | Optional | Uploads completed posts to the Pi, verifies them and archives PC originals |
| Health monitor | Optional | Pi/TMC warning display and persistent automatic Pause policy |
| Forced individual-motor recovery | Optional, Cartesian only | Carefully reviewed service recovery—not normal jogging |

## Before touching the controller

1. Read [Compatibility](COMPATIBILITY.md), [Installation](SETUP.md), [Full-system setup](PREFLIGHT-SETUP.md), [Testing](TESTING.md) and [Recovery](RECOVERY.md).
2. Confirm the machine already works normally in Klipper/Mainsail.
3. Save full, offline copies of `printer_data/config`, the Mainsail web directory, Moonraker custom components and any local Fusion configuration.
4. Record the current Klipper, Moonraker and Mainsail versions. This preview's installer is deliberately limited to Mainsail 2.17.0.
5. Stop all jobs. The controller must be Ready, unpaused and motionless. A restart loses homing and physical work references.
6. Compare the reference macros against the tester's loaded macros. Do not copy reference pins, homing directions, motor mappings or `rename_existing` chains blindly.
7. Keep the controller on a trusted LAN. Do not expose an unauthenticated Moonraker instance to the internet.

## 1. Obtain the source

```sh
git clone https://github.com/dung-adumbs/Mainsail-CNC-Pendant.git
cd Mainsail-CNC-Pendant
```

For an update, preserve local configuration first, then fetch and inspect the changes before replacing installed files:

```sh
git status
git fetch origin
git log --oneline --decorate HEAD..origin/main
git diff HEAD..origin/main
```

Do not run `git reset --hard` against a customized installation.

## 2. Install the web interface

Run the installer **on the Pi**. The first invocation is a dry run:

```sh
python3 tools/manage.py install \
  --mainsail-dir ~/mainsail \
  --config-dir ~/printer_data/config \
  --moonraker-url http://127.0.0.1:7125
```

Review every planned path. If it is correct and the machine is idle:

```sh
python3 tools/manage.py install \
  --mainsail-dir ~/mainsail \
  --config-dir ~/printer_data/config \
  --moonraker-url http://127.0.0.1:7125 \
  --apply
```

The installer checks Mainsail 2.17.0, refuses a conflicting existing CNC loader, verifies the machine is Ready and not running or paused, backs up the complete local configuration and every managed web file, writes the separate Pendant assets plus one navigation loader, and prints the conflict-checked uninstall command. It does **not** change machine pins/macros or restart Klipper/Moonraker.

Open `http://PI-ADDRESS/cnc-pendant.html`. The normal dashboard remains available. At this point the UI may display, but verified Start/Resume should remain unavailable until the backend and macros are installed coherently.

## 3. Install verified G-code preflight

Follow [Full-system setup](PREFLIGHT-SETUP.md) carefully. In summary:

1. Copy `moonraker/cnc_gcode_scan.py`, `cnc_travel_optimize.py` and `cnc_preflight.py` into `~/moonraker/moonraker/components/`. Add `cnc_health.py` only if its optional monitor will be reviewed and enabled.
2. Add a reviewed `[cnc_preflight]` section to `moonraker.conf`, initially leaving optional health disabled.
3. Copy `moonraker/cnc_preflight_guard.cfg` into the Klipper configuration and include it once.
4. Merge—not blindly replace—the required reference behavior from `examples/lowrider-v4/cnc-macros.cfg` and `job-speed-policy.cfg`.
5. Review the actual loaded macro chain, then generate that machine's own hash profile with `tools/review_macro_profile.py`. A generated hash is change detection, not a safety review.
6. Only while idle, restart the affected services. Expect homing and work references to be lost.
7. Query `/machine/cnc_preflight/status`, then test with a tiny known millimeter file and the router/spindle off.

Do not leave guarded macros installed without the matching Moonraker component, or vice versa. Treat rollback as one coherent dependency set.

## 4. Optional health and battery reminders

Read [Hardware health monitor](HEALTH.md). The monitor reports discrete TMC `otpw`/`ot` flags; it does not invent numeric driver temperatures. A qualifying warning must persist before it requests the existing Pause workflow, and it never automatically resumes.

The current UI also supports a battery-powered manual router profile. It can require checks at job start/tool changes, track approximate active runtime, show periodic reminders and request a controlled Pause if a reminder is ignored. This is elapsed-time guidance, not voltage or state-of-charge telemetry. Configure AC/controlled spindle mode if battery reminders are inappropriate.

Enable these only after reviewing their Pause interactions and testing with no cutter motion.

## 5. Android

The simplest phone test is the browser URL. For a dedicated application, download [`android/apk/CNC-Pendant-preview.apk`](../android/apk/CNC-Pendant-preview.apk), install it using Android's normal sideload flow, enter the Pi's trusted-LAN address and connect.

The wrapper contains no machine IP, motion logic or native command bridge. It loads the same current page from the Pi, keeps the screen awake and restricts in-app navigation to that controller origin. See [Android details and source build](ANDROID.md).

For a first external test, verify the browser URL first; install the APK and enter the same base address; compare disconnected/unhomed/ready states with desktop; then supervise only the smallest jogs with clear space and a physical stop available.

## 6. Windows desktop window

A normal browser tab works. The optional browser shell creates a dedicated app-style window and separate browser profile while keeping full Mainsail access.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd .\windows
.\Install-BrowserShell.ps1 `
  -PythonwPath "C:\Path\To\Python\pythonw.exe" `
  -MachineAddress "http://192.168.x.x" `
  -DryRun
```

Review its destinations and hashes, then repeat without `-DryRun`. It installs only for the current user and creates Desktop/Start-menu shortcuts. It does not install a browser, alter the controller, or stop a running job when its window closes. See [Windows details](../windows/README.md).

## 7. Fusion post

Copy [`post/Mainsail-CNC-Pendant.cps`](../post/Mainsail-CNC-Pendant.cps) into a Fusion personal post-library folder, then select it for the intended NC Program. The current post is version 0.13.

It uses millimeters and a manual-router workflow; emits setup, operation, tool, stock and assigned-machine metadata; marks travel for optional reviewed optimization; and inserts mandatory pause markers when requested spindle RPM begins or changes. It does not command a spindle relay/PWM output or measure physical RPM.

Read [Fusion post and travel rules](FUSION-TRAVEL.md). The post's stock-relative clearance plane is separate from Pendant Safe Z. Neither proves clamp clearance.

## 8. Fusion CNC Outbox add-in

On Windows, copy the complete `fusion-addin/CncOutbox` directory into the user's Fusion add-in directory, normally:

```text
%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\CncOutbox
```

Create an uncommitted `config.json` beside `CncOutbox.py` with local paths:

```json
{
  "output": "C:/Users/YOU/Documents/Fusion 360/NC Programs/Outbox",
  "postDescription": "Mainsail CNC Pendant - marked travel (manual router, mm, one tool)"
}
```

In Fusion, open **Utilities → Scripts and Add-Ins**, select `CncOutbox`, enable **Run on Startup**, and Run it. Assign the intended local machine to every Manufacture setup. Generate and simulate toolpaths normally. Select a setup, NC Program or operations from one setup; choose **Post to CNC Outbox**; then review machine identity, operation order, stage/tool changes and the optional memo.

The command splits consecutive tool stages without reordering operations. A returning tool creates another later stage. It publishes nothing until every native post succeeds and its outputs pass checks. It does not start a machine. See [Fusion add-in details](../fusion-addin/README.md).

## 9. Optional Windows Outbox helper

Install Python 3.10+ for the current Windows user, then run from PowerShell:

```powershell
cd .\pc-outbox
.\install.ps1 `
  -Python "C:\Path\To\Python\python.exe" `
  -InstallDir "$env:LOCALAPPDATA\Programs\CNC-Outbox-Helper" `
  -Outbox "$HOME\Documents\Fusion 360\NC Programs\Outbox" `
  -Sent "$HOME\Documents\Fusion 360\NC Programs\Sent" `
  -Server "http://192.168.x.x" `
  -NoStart
```

Inspect `config.json`, ensure only one helper uses these folders, then remove `-NoStart` or launch the created Startup shortcut. The helper uploads a stable file to `gcodes/Inbox`, reads it back, verifies SHA-256, reconfirms the source did not change, and only then archives the PC original with a receipt. It never starts or optimizes a job. See [Outbox helper details](../pc-outbox/README.md).

## 10. First-test sequence

1. Run the automated tests in [Testing](TESTING.md).
2. Compare native Mainsail and Pendant Ready/Disconnected/Unhomed states.
3. Test settings, units, files, keep-outs and dialogs without motion.
4. Use a tiny known file and router/spindle **off**.
5. Verify refusal when unhomed, after changing a zero/file, and when bounds/keep-outs fail.
6. Supervise homing; verify axis directions and limits independently.
7. Use disposable zeros and perform an air test above clear stock.
8. Test Pause, ordered Resume, tool-change confirmation and Abort with no cutter engaged.
9. Test network loss. Never assume a browser disconnect stopped queued motion.
10. Only then attempt a conservative cut, with the physical stop immediately available.

Report the machine/board, kinematics, software versions, browser/phone, installed optional components, exact reproduction steps, screenshots/log excerpts, and whether the result was motionless, an air test or a real cut. Remove IP addresses, credentials, MCU serials and private G-code before posting publicly.

## Known limitations

- LowRider-specific homing, pause, LEDs and paired motor assumptions remain in the reference integration.
- Manual router RPM is prompted, not measured or controlled.
- Chip load is calculated from programmed feed, requested RPM and flute count; it is not cutting-force feedback.
- Keep-outs guard Pendant moves and preflight but do not rewrite arbitrary macros, console commands, homing or CAM output.
- Recovery records help reconstruct context but do not make post-E-stop recovery automatic or collision-proof.
- Browser/API availability depends on the Pi, network, Moonraker and Klipper.
- Mainsail upgrades may replace the injected loader; retain the installer backup and re-review compatibility.
