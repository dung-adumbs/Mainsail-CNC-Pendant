# Installation and first checks

This preview is adapted to **Mainsail 2.17.0** with an existing working Klipper/Moonraker CNC. It adds a separate page; it does not replace your machine firmware or CAM workflow.

1. Save a full backup of printer configuration and Mainsail assets. Stop all jobs and motion. Do not install while paused.
2. Review `docs/COMPATIBILITY.md` and compare `examples/lowrider-v4/` to your macros. Required interfaces include HOME_ALL/HOME_X/HOME_Y/HOME_Z, ZERO_X/Y/Z/XY/ALL, START_JOB, PAUSE, RESUME, CANCEL_PRINT, `_CLIENT_LINEAR_MOVE`, and the optional light/idle macros. Do not blindly include the reference file: its G28 and pause overrides may conflict with existing definitions.
3. Ensure Moonraker permits this local client to read objects and use its database. Use the same origin as Mainsail. Keep the controller on a trusted network; do not expose an unauthenticated controller to the internet.
4. Run the installer dry run, then inspect its plan:

```sh
python3 tools/manage.py install --mainsail-dir ~/mainsail --config-dir ~/printer_data/config
python3 tools/manage.py install --mainsail-dir ~/mainsail --config-dir ~/printer_data/config --apply
```

The installer checks the Mainsail version, refuses an existing managed loader, backs up full configuration locally (which may contain private settings), and records original/installed hashes. It copies seven UI assets and injects only a navigation loader. It does not restart a service or modify machine macros/includes. Open `/cnc-pendant.html` after reviewing controller prerequisites.

## Full-system dependency

Current Start/Resume requires the custom Moonraker scanner, reviewed macro profile and Klipper guard. Follow [PREFLIGHT-SETUP.md](PREFLIGHT-SETUP.md). The installer stages UI assets only.

## Controller examples

`cnc-macros.cfg` is the **LowRider reference**, not a universal profile. Inspect homing direction/order, pause lift and saved-state restoration. `work-light.cfg` contains an example physical pin and save-variable path; change them for your hardware. Keep one `[save_variables]` instance only.

`job-speed-policy.cfg` wraps M220 to persist its value and wraps SDCARD_PRINT_FILE to invoke START_JOB. START_JOB must cap the actual factor:

```ini
[gcode_macro START_JOB]
gcode:
  {% set percent = printer.gcode_move.speed_factor|float * 100.0 %}
  M220 S{[percent, 100.0]|min}
```

The full reference already includes this cap. Include the policy once only after confirming no M220/SDCARD_PRINT_FILE rename conflicts. It requires `[save_variables]`. On restart it restores the saved override at no more than 100%. On new file start it keeps a slower factor or caps a higher one at 100%. Resume is not a new start.

Optional recovery: `--recovery --klipper-dir ~/klipper` stages the Cartesian-only extension and a separate config fragment. The installer does not enable its include or restart Klipper. Review the module and individual motor semantics first. Its controls are unavailable if the extension is absent.

## AI-assisted adaptation

Give an assistant this repository plus your relevant, sanitized homing/pause/LED macros. Ask it to identify conflicting names and physical assumptions before changing files. Require a backup, a dry-run plan, tests without physical motion, then supervised clearance/homing tests. Never ask an assistant to infer safe spindle wiring or clearance from the UI alone.

## Recovery

Keep the installer’s printed BACKUP path. See [Recovery](RECOVERY.md). Review and test the page after upstream Mainsail upgrades, which may overwrite index.html.
