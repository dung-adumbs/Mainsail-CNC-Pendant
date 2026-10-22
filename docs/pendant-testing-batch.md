# Pendant testing changes — 22 October 2026

This batch is installed on the Pi. Reconnect the Android app once to load the current page: gear → Reconnect, or Android Back → Reconnect. Future page updates can also be loaded with Machine → Reload pendant. No APK update is required.

## Controls and feedback

- Start/Resume and the loaded filename occupy the lower-left jog quadrant. The separate staged-file panel above the jog controls is removed. Start still confirms the full filename and current verification. Resume appears only in the quadrant; the lower action bar retains Pause while running.
- Files → Clear loaded file clears the staged selection while preserving the original G-code and analysis records. It is blocked during running, paused or returning operations. An old Start confirmation cannot authorize a file after the selection is cleared or changed.
- Missing axes are identified in the quadrant, including when a loaded file cannot start.
- Run speed arrows adjust by 10 percentage points. Direct entry remains available. The preset offers 50% at a current setting of 60% or below, and 100% at 61% or above, as requested.
- Below the configured Safe Z, X/Y jog buttons and all XYZ Machine/Work entry fields turn yellow. Locked horizontal and downward direct/jog moves require clearance confirmation. The selected below-safe jog cap remains effective after permission is granted. Upward Z escape does not require confirmation.
- An upward Z move crossing Safe Z is sent as two absolute segments: capped speed up to Safe Z, then the selected jog speed above it. A selected speed below the cap remains the lower speed.
- Steppers shows the time until automatic disable, including idle reminder and grace. Running/paused states show the hold; disabled motors and an inactive light-dependent timer are identified. Its dialog offers Reset idle timer, Snooze warning, settings and a separately confirmed Disable steppers action. Reset clears a previous snooze and starts the full idle reminder again. Snooze remains fifteen minutes. Existing saved timer settings are preserved.
- The current bottom status message clears on the next actual command. Up to 100 prior messages remain in a per-page scrollable history. Background LED activity does not clear the message, and new entries do not pull a reader away from their scroll position.

## E-stop and Resume recovery

E-stop immediately stops Klipper; it does not reboot the Pi. The pendant opens a Controller stopped dialog with a separate Restart controller action and Cancel. It also detects shutdowns originating elsewhere. A persistent stopped-status link reopens the dialog after Cancel. Restart checks the controller state again, resets firmware explicitly, and requires rehoming/re-establishing work zeros afterward. There is no automatic restart or automatic job resume.

Resume confirmation is brief, with technical bounds under Details. The Pi acknowledges an accepted Resume promptly and reports Returning to saved position until its ordered lift/XY/lower operation completes. Duplicate Resume requests, staging/clearing files, and pendant jogging are blocked during the return. The interface checks actual controller state when a response is lost. Approval cleanup errors do not falsely label a completed Resume as failed.

## Validation and recovery

Automated tests cover the 60/61 preset boundary, split-speed Z crossing, XY confirmation, idle/grace/snooze countdowns, 15 service cases including long asynchronous Resume, duplicate requests, return errors, changed files/offsets and clearing a selection without deleting G-code. Existing motion/coordinate/recovery tests also pass. Simulated UI tests exercised E-stop/restart, cancelled/reopened recovery, simplified Resume, disabled return controls, message history, direct XY confirmation, Start confirmation and clearing the loaded file. Tests did not command physical motion or E-stop on the machine.

The reference deployment backed up changed files before installation. Use your own recorded backup paths for recovery; see RECOVERY.md and PREFLIGHT-SETUP.md.

Physical commissioning of the revised motion behavior remains a supervised air test. Saved tool-Z recovery is still a later feature.
