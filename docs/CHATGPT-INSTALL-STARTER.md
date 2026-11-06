# Install with ChatGPT or Codex

This is the short starting document for adapting Mainsail CNC Pendant to another Klipper CNC with an AI assistant. It is designed to get to a useful installation quickly without asking the assistant to guess machine wiring, pins, motion directions or safe clearances.

The assistant needs access to a checked-out copy of this repository and sanitized copies of the machine configuration. If it can work directly on the controller, give it access only over a trusted local network and keep the machine idle. Never paste passwords, Wi-Fi credentials, API keys or private backup archives into a public chat.

## What the owner should collect first

- Machine type and kinematics.
- Controller board and host computer.
- Klipper, Moonraker and Mainsail versions. The current UI installer targets Mainsail 2.17.0.
- Axis travel, homing direction, endstop arrangement and paired motors.
- The main Klipper configuration plus every included file that defines homing, `PAUSE`, `RESUME`, `CANCEL_PRINT`, `G28`, `M220`, zeroing or job-start behavior.
- Relevant `moonraker.conf` sections and existing custom components.
- Router/spindle type: manual AC, battery powered or electronically controlled.
- The normal Mainsail and printer-data paths on the Pi.
- One tiny representative millimeter G-code file for motionless parsing and a later supervised air test.

Photographs and screenshots are helpful context, but they cannot establish switch polarity, motor mapping or safe clearance. The owner must confirm physical facts that are not present in configuration.

## Copy this request into a new ChatGPT or Codex chat

> I want to install Mainsail CNC Pendant on my existing Klipper CNC. The repository is https://github.com/dung-adumbs/Mainsail-CNC-Pendant. Read `docs/CHATGPT-INSTALL-STARTER.md`, `docs/TESTER-GUIDE.md`, `docs/AI-IMPLEMENTATION-HANDOFF.md`, `docs/SETUP.md`, `docs/PREFLIGHT-SETUP.md`, `docs/COMPATIBILITY.md` and `docs/RECOVERY.md` completely before changing anything.
>
> Start with a read-only compatibility audit of my actual Klipper/Moonraker configuration and installed versions. Map all affected include files and macro wrapper/`rename_existing` chains. Tell me which facts are known from configuration and which physical facts I must confirm. Do not assume the LowRider V4 examples match my machine.
>
> Prepare a staged installation plan, exact local backups with hashes, and a coherent rollback plan. Keep normal Mainsail available and install Pendant as a separate page. Run the UI installer in dry-run mode first. Adapt rather than blindly replace my macros, and install the Moonraker preflight component and Klipper guards as one reviewed dependency set.
>
> You may inspect files, prepare patches, run automated software tests and perform motionless HTTP/API checks. Do not home, jog, start or resume a job, energize a spindle, release steppers, restart Klipper/Moonraker or deploy changes to the live controller without telling me the effect and obtaining my explicit authorization for that action. Never weaken or bypass a verification guard merely to make a job start.
>
> After software tests pass, give me a short supervised commissioning checklist: interface-only checks, router-off parsing, smallest clear-space jogs, air cut, Pause/Resume, tool/RPM prompts, network loss and rollback. Finish with an installation report listing the repository commit, installed files, local backup location, tests, machine-specific adaptations and remaining limitations.

Then attach or make available the collected configuration. State whether the assistant is working only on a local copy or has direct controller access.

## Expected fast path

1. **Audit only.** The assistant reports compatibility, conflicts, missing inputs and the proposed file set before editing the live machine.
2. **Back up.** It creates private local backups and records hashes. Backups do not belong in the public repository.
3. **Stage the web page.** It runs `tools/manage.py install` without `--apply`, reviews the plan, then asks before applying it. This step alone does not enable verified Start/Resume.
4. **Adapt the backend.** It reviews and installs the Moonraker preflight components and merges the Klipper guard behavior with the existing macro chain. Reference configuration is not pasted wholesale.
5. **Test without motion.** It runs all Python and Node tests, syntax checks, file scanning, bounds rejection, missing-profile rejection and changed-file rejection.
6. **Commission deliberately.** Only after the owner authorizes any required restart does the owner rehome, restore work/tool references and conduct the supervised tests.
7. **Install optional clients.** Once the browser page works, install the Android wrapper, Windows browser shell, Fusion post/add-in or PC Outbox helper as needed.

## Minimum acceptance checklist

- Normal Mainsail still opens and remains usable.
- `/cnc-pendant.html` loads on desktop and phone.
- The repository commit and installed asset versions are recorded.
- Unhomed, changed-file, unsupported-command, out-of-bounds and missing-backend conditions fail closed.
- Start and Resume cannot bypass the reviewed approval path through normal Mainsail controls.
- Units, machine/work coordinates, Safe Z and keep-outs match the actual machine.
- Tool, operation, requested RPM, feed and flute metadata appear when supplied by the Fusion post.
- Pause and ordered Resume are tested with the router off before cutting.
- Rollback restores the complete previous dependency set and preserves newer unrelated edits.

## Optional workflow pieces

The basic browser installation does not require every optional piece. Add them only after the core page and verified Start/Resume work:

- `android/apk/CNC-Pendant-preview.apk` provides a dedicated phone window but still loads the live Pi page.
- `windows/Install-BrowserShell.ps1` creates a dedicated Windows app-style window.
- `post/Mainsail-CNC-Pendant.cps` emits Pendant metadata, tool stages and manual RPM-change markers from Fusion.
- `fusion-addin/CncOutbox` reviews selected operations and posts ordered one-tool stages.
- `pc-outbox` transfers stable posts to the Pi, verifies SHA-256 and archives the PC originals.
- `cnc_health.py` and the battery reminder are optional Pause policies, not independent safety controllers.

For the detailed reasoning and edge cases an assistant must follow, continue with [AI implementation handoff](AI-IMPLEMENTATION-HANDOFF.md). For human-readable end-to-end instructions, use [Tester guide and executive summary](TESTER-GUIDE.md).
