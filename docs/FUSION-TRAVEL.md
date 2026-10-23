# Fusion post and optional marked-travel preparation

Use `post/Mainsail-CNC-Pendant.cps` for a deliberately limited Klipper workflow: one tool, one existing work origin, millimeter output, manual router, no automatic homing/probing. It extends the reference simple post, not the third-party GRBL/Marlin post. It linearizes arcs and expands drilling cycles. Unsupported tool changes/multi-axis work are refused.

## Set up Fusion

Import the CPS through Fusion's Post Library. Review every property; do not assume old presets selected the new defaults. Work Z0 must be stock top. Set **Safe XY travel plane** above stock and all fixtures the path crosses. This is a CAM declaration, separate from the pendant's manual-jog Safe Z setting.

The post uses explicit feeds and emits versioned comments:

```gcode
; CNC_PENDANT_OPTIMIZER: V1
; CNC_POST_VERSION: Mainsail-CNC-Pendant 0.5
; CNC_TRAVEL_CLEARANCE_MM: 5.000
G90
G21
; CNC_MOVE: TRAVEL_XY
G1 X100.000 Y50.000 F3000.0
; CNC_MOVE: PLUNGE
G1 X100.000 Y50.000 Z-1.000 F180.0
```

Each marker applies to exactly its immediately following linear move. Segmented moves each carry their own marker and feed. The original file is runnable through the ordinary verification workflow; optimization is optional. Markers describe posting intent, not independently measured physical clearance.

Only genuine rapid intent reported by Fusion is classified as rapid in linear callbacks; a high cutting move is not inferred to be travel. If Fusion does not retain that intent, the move remains CUT/LINK and cannot be accelerated by the optimizer. Explicit post-generated positioning also receives appropriate markers. Raising Z precedes XY positioning, which precedes lowering Z.

## Files → Optimize travel

1. Upload a newly posted marked file. Files identifies **optimizer ready**. Older/unmarked files stay unmodified; repost them instead of manually adding a compatibility header.
2. Choose **Optimize travel…**, enter XY travel and upward-Z retract rates in **mm/min**, then **Preview**.
3. Review eligible/changed move counts, declared clearance and nominal time estimates. Machine velocity limits are checked with current and programmed run overrides. Estimates exclude pauses, acceleration, controller limits and unknown initial motion; they are not completion-time promises.
4. Choose **Create optimized copy**. A new file goes into `gcodes/cnc_optimized/` with source/output SHA-256 provenance. Preview alone writes nothing. The source is hashed again, and changed sources require another preview. Existing files are never overwritten.
5. Choose **Stage & verify copy**. The ordinary full scan, macro-profile, offset and Start guards still apply. Creating a file never starts motion.

Only marked level XY travel at/above declared clearance and proven upward vertical retracts can receive replacement feeds. Cutting, plunges, descents, uncertain initial moves and unproven links keep their original feeds. V1 requires G90/G21, linear G1 moves and explicit F on every move, and refuses unsupported syntax or inconsistent markers. Re-optimizing a copy is refused; use the original marked source. Files are limited to 64 MiB for preparation.

Original header time metadata becomes stale after feed changes; the optimized header says so. Source bounds are unchanged because the converter changes only F words. Subsequent tool/work offset changes still require the ordinary verifier to reevaluate travel.

## Backend installation and recovery

Install `cnc_travel_optimize.py` alongside `cnc_preflight.py` and `cnc_gcode_scan.py` in Moonraker's components directory. Restart Moonraker only while idle after backing up all affected modules. This adds no Klipper macro or wiring changes. The webpage installer still does not install backend modules automatically.

Rollback restores the matching previous UI and Moonraker modules together and restarts Moonraker while idle. Keep the prior CPS before updating a local post. Existing G-code files are never edited by this installation. Supervise initial air tests of newly posted/optimized programs before cutting.

## Validation and attribution

Automated tests exercise marker boundaries, geometry preservation, cutting/plunge feed preservation, malformed/legacy files, unknown starting positions, paused coordinate invalidation, stale-source rejection, active-job blocking and run-override limits. Post callback tests exercise CAM intent and retract/XY/lower ordering. Autodesk's installed post engine also interrogates the CPS successfully. This is not equivalent to posting every CAM strategy through Fusion or physical commissioning.

Design ideas were informed by the V1E discussions on [Fusion posts](https://forum.v1e.com/t/fusion-360-post-processor/49534) and [rapid conversion](https://forum.v1e.com/t/rapid-movements-for-fusion360-gcode-script/51379), and Autodesk's [post API](https://cam.autodesk.com/posts/reference/classPostProcessor.html). No third-party post was copied into this implementation.
# Same-tool Manual NC stops (post 0.6)

Ordinary Manual NC Stop and Optional Stop entries are same-tool fastener/inspection pauses. No special note text is required. The post emits `; CNC_PAUSE: SAME_TOOL_RETURN` immediately before `PAUSE_BASE`, allowing the optimizer to retain planned coordinates across that stop. Startup/tool setup pauses remain conservative. This post still rejects multiple tools in one file. Resume verification and return-path checks remain required; this marker does not authorize a zero change or bypass preflight. Previously posted files must be reposted to get the new markers.

# Non-cutting direct links (post 0.7)

Level XY moves that Fusion explicitly classifies as `MOVEMENT_LINK_DIRECT` can use marked travel at or above the declared clearance plane. This includes eligible links inside an operation, rather than only operation-entry positioning. Cutting links, ramps, helices and below-clearance direct links retain their original feeds. Do not infer travel from height alone. Repost to apply this classification; existing files marked CUT are not reinterpreted by the optimizer.

# CAM movement notifications (post 0.8)

The post captures Fusion's `onMovement` callback and emits `CNC_CAM_MOVEMENT` diagnostic comments when the category changes. This supplies movement intent to the rapid/direct-link classification and permits diagnosis of links that remain at cutting feed. The v0.7 reference file still contained 38 level Z6 bore-transfer lines marked CUT; v0.8 requires a fresh actual Fusion post to confirm those categories. No existing CUT lines are automatically reclassified.

# Stock-relative clearance (post 0.9 — current policy)

Version 0.9 supersedes the CAM-category-only eligibility rules below. The clearance property is now an **offset above Fusion stock top**, not above work zero. Fusion must provide `stock-upper-z`; missing stock stops posting. File and operation headers show stock bounds when available, stock-top work Z, offset and calculated plane. An optional Material name property supplies a descriptive header note; physical-material assignments are not assumed to be exported.

All level XY moves at or above the declared plane use travel feed, including moves Fusion labels CUT. Set the offset above every fastener/clamp crossed by travel. This is a user-declared clearance rule, not collision detection. Descending, ramping and below-plane moves keep their feeds. A new actual Fusion post must be inspected before running; old CUT markers are not retroactively changed. Pendant Safe Z remains a separate manual-jog setting.

# Pure Z boundary splitting (post 0.10)

Pure vertical linear moves now split at stock top on ascent, or stock top plus clearance offset on descent. Above stock top an ascending segment uses Z travel feed; a descending segment uses Z travel feed only down to the clearance plane. Remaining portions retain their original feed. Combined XY/Z, ramps and helices are not eligible for this rule. `TRAVEL_Z` markers let the optimizer change the separate Z travel feed while validating the applicable boundary against stock metadata. Unknown initial positioning is not accelerated by this rule. Destinations and geometric paths are unchanged; extra collinear points identify feed changes. Repost with 0.10 and update the Pi optimizer before optimizing these markers.

# Setup identity (post 0.11)

`CNC_FUSION_SETUP` records Fusion's `job-description` setup name when provided, both in the file header and at operation entry. Missing names are explicitly reported as Not supplied. Setup names help suggest file groups but do not establish machining order or prove matching work origins. Users must review group membership and order; the pendant bundle builder is not yet implemented.

# Machine identity (post 0.12)

The header records machineConfiguration vendor, model and description. Missing machine assignment is reported explicitly. Assign the intended machine in Fusion Setup before using the CNC Outbox add-in. Metadata identifies the Fusion configuration; it is not proof of the physical controller or physical setup.

