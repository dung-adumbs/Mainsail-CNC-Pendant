# AI implementation handoff

Give this document and the repository to your AI assistant. Supply sanitized copies of your relevant Klipper and Moonraker configuration. Remove passwords, API keys, network credentials and MCU identifiers before sharing publicly. Keep a full private backup on your own machine.

## Copy this request to your assistant

> Help me adapt Mainsail CNC Pendant to my existing Klipper CNC. Read this handoff, README.md, docs/SETUP.md, docs/PREFLIGHT-SETUP.md, docs/COMPATIBILITY.md and docs/RECOVERY.md before proposing installation changes. Inspect the actual source and my configuration; do not assume the LowRider examples match my machine.
>
> First report compatibility, missing prerequisites and conflicting macro definitions. Prepare a concrete installation plan with local backups and a matching rollback procedure. Explain what requires individual machine review. Do not command motion, home, start/resume a job, energize a spindle, disable steppers or restart services without my explicit authorization for that action. Software preparation and motionless tests can proceed independently.
>
> Keep standard Mainsail available. Install the pendant as a separate page. Preserve my physical machine configuration and existing unrelated settings. Treat repository examples as reference code, not configuration to paste wholesale. Never disable a verification guard just to get a job to start.

## Information the assistant needs

- Klipper, Moonraker and Mainsail versions, host operating system and installation paths.
- Machine kinematics, axis travel limits and homing directions, single/dual motor arrangement, and how the machine is physically stopped.
- Relevant configuration includes, homing overrides, Mainsail client variables, pause/resume/cancel macros, zeroing macros and file-start wrappers.
- Existing light controls, saved-variable setup, idle/stepper policies, and any optional forced-motion extension.
- Spindle/router control method, including whether power is manually controlled.
- A small representative millimeter G-code file and its intended work/tool zeros.

Do not infer wiring, switch polarity, motor selection or safe physical clearance from a screenshot. Ask the owner when configuration cannot establish a physical fact.

## Required implementation sequence

1. **Inspect before editing.** Map configuration includes and every affected `rename_existing` chain. Identify the authoritative PAUSE/RESUME, G28, M220 and SDCARD_PRINT_FILE definitions. Verify the scanner supports the program's commands. Unsupported commands must remain blocked pending deliberate implementation/review.
2. **Back up locally.** Save original UI assets, full configuration and affected custom modules. Record exact paths and hashes, plus the files added or changed. Backups can contain secrets; do not upload them to a public repository. Prepare rollback commands against these exact originals.
3. **Stage the UI.** Run `tools/manage.py` without `--apply` first and review the plan. This installer handles UI assets and its optional recovery module; it does **not** install the full Moonraker preflight service or merge Klipper macros. Follow the full-system guide separately.
4. **Adapt controller interfaces.** Merge the necessary behavior with the owner's existing macros. Install the Moonraker scanner/service and Klipper guard together. Preserve pause-state capture, paused XY-zero protection, Z-zero approval invalidation and single-use Start/Resume approval. Standard-dashboard file Start/Resume is also gated once those wrappers are installed.
5. **Review the macro profile.** Review the actual loaded macro bodies before using `tools/review_macro_profile.py --write --reviewed`. A hash records what was reviewed; it does not prove the macro is safe. Never reuse a profile from another machine or silently regenerate one after changes.
6. **Run motionless checks.** Install development requirements and run the Python tests and all Node tests/syntax checks described below. Test changed-file rejection, out-of-bounds rejection, offsets, paused return paths and missing backend/profile behavior with mocks. Do not substitute real machine actions for mocked tests.
7. **Arrange supervised commissioning.** Explain required service restarts and their effects before asking the owner to perform/authorize them while idle. A Klipper restart loses homing/work references. Establish references again, then supervise small air tests with the tool clear before cutting. Test network loss, pause, cancellation and the physical stop procedure.
8. **Deliver an operating and recovery note.** List the installed files, backup location, versions, settings that persist, known limitations, restart procedure and exact uninstall steps. Confirm browser access before setting up the optional Android wrapper.

## Motionless test commands

From the extracted repository, using Python 3.11+ and Node 22+:

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -p 'test_*.py'
for file in src/*.js; do node --check "$file"; done
for file in tests/*.cjs; do node "$file"; done
```

The `for` commands above use a POSIX shell. Use equivalent loops on Windows. Passing tests validates the covered software behavior; it does not establish physical machine compatibility.

## Important boundaries

- The reference configuration assumes LowRider behavior, including upward Z homing and paired Y/Z motors. Limits read from Klipper do not make every recovery macro generic.
- Individual-motor forced recovery is optional and Cartesian-only. Do not enable it for CoreXY or other coupled kinematics. Review each motor's physical meaning before enabling it.
- Pendant jog guards and keep-outs do not rewrite CAM programs or protect arbitrary console/macro motion. Program verification checks configured travel and supported return paths, not clamps, stock or cutter collisions.
- The software E-stop needs a working communication path. Retain appropriate independent physical stopping hardware. Do not promise automatic spindle shutdown unless the actual hardware and configuration provide it.
- The Android app loads the Pi-hosted page. Most interface updates therefore require a page reconnect, not a new APK. Native app changes can still require an APK update.

## Recovery acceptance criteria

UI uninstall must use the recorded installer backup and respect newer conflicting edits. Backend rollback must restore the coherent previous configuration and macro chains, including Start/Resume wrappers. Do not leave gated macros without their guard, or remove gating as an unexplained workaround. After affected services restart, re-establish homing and work/tool zeros. Restoring files cannot recover physical position after steppers were released.

## Useful report for the project

With the owner's approval, share a sanitized compatibility report: machine type/kinematics, software versions, repository commit, adaptations, tests performed and unresolved issues. Exclude private backups, credentials and personal machine identifiers. Reports and pull requests are welcome; this remains an early developer preview.
