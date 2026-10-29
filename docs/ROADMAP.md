# Roadmap / next wish list

The current preview includes metadata, the Mainsail viewer, background G-code scanning, staged Start, paused-quadrant Resume, confirmation dialogs and the Android wrapper. Remaining priorities:

- Optional saved tool-Z safety reference after homing, with explicit confirmation.
- Guided full-system installation covering Moonraker and Klipper macro chains beyond the current UI-only installer.
- Direct spindle on/off and RPM once suitable hardware and shutdown behavior are reviewed.
- Probing, touch-plate and tool-change workflows after hardware validation.
- Generic configuration/profile layer, configurable axis/motor labels and rate presets; broader-machine validation.
- More Android device testing, stable release signing and distribution, improved installation/upgrades.
- More accurate job-time estimates; estimated remaining time currently extrapolates file progress.

Current source is a working reference snapshot, not a completed generic CNC distribution.
# File/project workflow

- Deployed review preview: automatic document/date groups, compact stage selection/reorder, single-tool confirmation and named shared manifests with file hashes. See PROJECTS.md. Strict combined G-code, speed preparation, logical project collections and legacy checksum-verified browse/restore are implemented. Stage completion tracking and reviewed unused-file archiving remain future work.
- Offer Archive unused Inbox files after saving a project, showing the exact files before moving anything. Never silently discard unselected files.
- After confirmed successful job/bundle completion, offer Archive completed job. Move the project manifest and its files out of the active list; preserve hashes, tool order, originals/optimized provenance and dates. Provide archive browsing and Restore for rerun. Restoring does not restore machine homing or tool/work zeros and requires fresh verification. No completion prompt for a paused, failed or cancelled job; never move a file still in use.

