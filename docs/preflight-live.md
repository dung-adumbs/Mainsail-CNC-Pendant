# CNC file verification — live preview, 22 October 2026

Files opens a larger file list with header comments, available metadata, and a preliminary boundary notice. Missing metadata is explicitly reported. Metadata is only a quick warning: it cannot authorize Start.

Select **Stage & verify** to return to the main pendant. The Pi reads the actual G-code in the background, showing progress. A separate **Start job** confirmation is available only after analysis and current-setup verification pass. The original G-code is never rewritten.

The Pi stores analysis JSON at `~/printer_data/cnc_preflight/<SHA-256>.json`, including hash, size, modification time, analysis time, move count and tool sections. Start and Resume hash the file again and check the current work offsets and machine travel. A short-lived, single-use Klipper guard also binds approval to the current position, zeros and selected filename. Standard Mainsail Start/Resume requests now require approval through CNC Pendant too.

PAUSE_BASE divides a program into verifiable tool sections. Comments alone never create a stopping boundary. Future sections require verification using their actual tool zeros. Paused Resume checks remaining motion and the lift/XY/lower return path. Paused X/Y zeroing is blocked; setting tool Z zero opens another verification check. A confirmed Resume control also appears in the paused jog quadrant.

Unsupported commands, inherited unknown coordinate modes, R-form arcs, unmatched loops and macro-profile changes prevent approval. Supported geometry includes explicit G90/G91, millimeter G0/G1, IJK arcs, and closed absolute-position SD loops. G20 is rejected because this Klipper installation expects millimeter G-code. A small set of reviewed, non-motion hooks (START_JOB, END_JOB, LED_ON/OFF and CNC_TEST_PREFLIGHT) requires matching controller-profile coverage. Arbitrary macros and coordinate-changing commands are not silently guessed.

**Scope:** this checks programmed travel against configured machine limits. It does not certify stock, clamps, fixtures, tool clearance, cutting parameters, or spindle power. Viewer visualization is separate from verification; enable travel display for non-extruding CNC paths.

Five G-code files scanned successfully on the Pi: roughly 1.5–40 seconds, from 9,220 to 224,482 moves. No physical motion was used for verification. Start/Resume gates, modified-file detection, offset changes, arc extrema, loop bounds, paused XY blocking and return-path overflow have automated tests. A supervised short air-cut remains the next physical commissioning step.

Recovery is installation-specific. Retain local deployment backups; see RECOVERY.md and PREFLIGHT-SETUP.md.

## Follow-up batch

- The countdown and Reset idle timer controls are now installed; see `pendant-testing-batch.md` for the complete follow-up changes.
- Saved tool-Z recovery after homing remains a later feature.
