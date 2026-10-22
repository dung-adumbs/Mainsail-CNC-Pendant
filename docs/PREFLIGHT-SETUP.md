# Full-system setup: developer preview

The UI and controller verification are separate installations. This release includes the working reference source, not a universal one-click controller installer. Start/Resume stays blocked if the backend or reviewed macro profile is missing.

## Back up and compare

Keep the UI installer's local backup and independently copy Moonraker configuration, Klipper configuration and custom modules. Stop all jobs and motion. Compare the reference macros with your own; avoid duplicate PAUSE_BASE, G28, M220 and SDCARD_PRINT_FILE definitions. Preserve machine pins, limits and kinematics.

## Install the components

Copy `moonraker/cnc_gcode_scan.py`, `moonraker/cnc_travel_optimize.py` and `moonraker/cnc_preflight.py` into Moonraker's `moonraker/components/` directory. Add to moonraker.conf:

```ini
[cnc_preflight]
cache_path: ~/printer_data/cnc_preflight
profile_path: ~/printer_data/config/cnc_preflight_profile.json
```

Copy `moonraker/cnc_preflight_guard.cfg` to Klipper configuration and include it once. Deliberately merge the reference `examples/lowrider-v4/cnc-macros.cfg` and `job-speed-policy.cfg`: pause captures offsets, machine XY and file position; paused XY zeroing is rejected; ZERO_Z invalidates approval; ordered Resume and file start consume approval. `_CLIENT_VARIABLE.user_resume_macro` must select CNC_RESUME_ORDERED. The reference depends on Mainsail pause helpers. Review every rename_existing chain.

The guard also affects standard-dashboard Start/Resume, requiring pendant verification. Changed macro bodies invalidate the review profile.

## Record the reviewed macro profile

After reviewing the actual loaded configuration, run `tools/review_macro_profile.py` to list the macro names. Then use `--write --reviewed` to record hashes only after reviewing those definitions. A generated hash detects changes; it does not perform a safety review. Never copy another machine's profile.

Restart Moonraker and Klipper only while idle after all definitions are coherent. Restart clears homing/work references. Rehome and establish tool/work zeros before use. Arcs require `[gcode_arcs]`; loops require `[sdcard_loop]`. Unsupported constructs block approval.

## Test and recover

Run automated tests, check `/machine/cnc_preflight/status`, and stage a small known millimeter file. Test bounds, changed zeros and file edits before supervising air cuts. Keep a physical emergency stop.

UI uninstall uses its recorded backup. Backend recovery must restore the complete prior Moonraker configuration/components and macro chain together, including Start/Resume wrappers. Remove only the added guard include/component section. Do this while idle, restart affected services, and re-establish homing/zeros. Do not leave gated macros without their guard. Sidecars and preferences may remain for inspection.
