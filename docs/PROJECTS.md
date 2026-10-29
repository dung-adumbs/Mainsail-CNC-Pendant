# Inbox and prepared programs

The normal Files view now opens **Inbox**. Each posting batch stays separate, sorted by posting time, with full Fusion document/setup names and optional memo. A batch may contain only selected operations; it never silently replaces another batch or a staged program. **Prepared programs** is a separate view. Originals remain physically preserved; these are logical queues.

Open a batch to see Fusion document, memo if supplied, setup, posting time and ordered tool descriptions. All stages are included by default; review the selection and shared X/Y/stock-top Z reference. Travel values start from the latest saved preparation for the same document/setup/machine names, otherwise shared system defaults. The source of the values and system values are shown. Use system defaults resets the inputs; edits affect this preparation only. Cutting feeds are retained from Fusion. These name matches are not stable cross-rename identities.

**Prepare program** rechecks source hashes, asks for attention-tool confirmation where required, combines the selected source stages, automatically previews and creates the travel-adjusted copy, verifies the project record, and offers **Stage & verify**. There is no separate save/reopen/combine/preview/create sequence in the normal path. The internal intermediate lives under Projects/ and final copy under cnc_optimized/. The project links both. No stage, verification or machine start is automatic.

Inbox includes unfinished saved projects; only a successfully recorded final output is shown under Prepared programs. Unselected original stages are retained in source_stages so they do not reappear as misleading incomplete batches. Previous output references are preserved when preparing another version. No source is deleted, moved or physically archived. Record/source/optimizer failures remain recoverable and must not expose Stage & verify for an unrecorded output.

Preparation checks file integrity, canonical post compatibility, tool metadata and selected ordering. It does not check the job envelope against today's work zero. Existing backend motion/health/keep-out verification remains at Stage & verify and Start/Resume. Backend preparation still requires an idle controller and applies its existing velocity/override ceilings. Pendant Safe Z and Fusion stock-relative clearance remain distinct.

Details/advanced retains editable program name, memo, setup sheet and the previous project controls for saved projects. Active/Reusable/Archived collections and legacy archive restoration remain available; archiving is not completion certification. Automatic successful-completion history and reviewed physical project archiving remain pending.

Validation includes real BONE source compilation in a mocked phone workflow, automatic preview/create, required tool checks, source-hash rejection, incomplete batches, failed final-record saves, and read-only deployed UI inspection. No physical behavior is certified by these tests.

---

## Earlier implementation notes (historical)

# Project review preview

Files opens a compact Jobs/Projects view. New Inbox posts are suggested as `{ Fusion document · posting date } (file count)` groups using the original Job header, not the helper's truncated filename. Unknown documents are isolated, rather than silently grouped. Other legacy files remain available through Other files.

Open a suggested group to select membership and reorder stages. Four stage rows fit on the phone review screen; longer groups use pages. Details contains setup, full tool notes, operation sequence, stock/travel metadata, source path and SHA-256. Labels are descriptive suggestions, not machining-order decisions.

A one-file group offers Confirm single-tool job. Saving requires one identified tool per selected post and explicit membership/order review. Single-tool metadata is not a substitute for G-code verification. A saved job/project is stored in Moonraker database namespace `cnc_projects`, one item per project ID. The manifest records order, paths, full byte hashes, source metadata, timestamps and optimized-source provenance where declared. Reopening checks current bytes against saved hashes. Saving rechecks bytes and reads back the shared record. Originals are not modified or moved.

Reviewed files disappear from the suggested-group list because they are linked to a saved project. They remain physically in Inbox. This release changes the logical queue, not physical archive location. A source arriving later with a new hashed path is a new pending post. Concurrent editing of the same saved project is not coordinated; use one editor at a time.

Prepare opens a short Stage & verify step. It never starts the machine. Existing backend verification and explicit Start remain authoritative. Routine metadata stays behind Details; verification failures remain visible. Pendant Safe Z and Fusion stock-relative clearance remain separate.

Saved projects now offer Combine & set travel speeds. Confirm stage order and the shared X/Y origin and stock-top Z reference. The strict compiler accepts original canonical post 0.12 one-tool sources with matching machine/document/clearance declarations and current SHA-256 fingerprints. It preserves every motion and pause, adds stage labels and aggregate bounds, removes intermediate completion notices, and writes a unique checksum-verified Projects/<name>__combined__<timestamp>_<hash>.gcode. The existing backend travel preview opens immediately; creating its optimized copy records that final path on the project. Reopen to Continue travel settings or Prepare consolidated file. Generating never stages or starts the job. Source posts remain unchanged. Tool changes still need actual tool Z verification.

Automatic next-stage execution, completion tracking, reviewed unused-file archiving, and successful-project archive prompts remain planned. Logical Active/Reusable/Archived collections and legacy archive browse/restore are available.

Validation: grouped metadata and SHA-256 compared with Node crypto; mock browser tests cover reorder, shared save/readback, correct stage preparation and 390px-wide layouts at 640/740/844px height. Live reference Pi confirms one four-file group and full operation counts 8/3/1/1. Named-project writes were tested with a mock database; the owner saved the actual P38 rollup manifest. The four actual sources compile into 441805 moves and four pauses; offline full scanner reports no issues and the existing optimizer accepts the combined file. No machining tests were performed.

Enabled keep-outs now participate in server-side Start/Resume approval: machine-coordinate section envelopes plus configured XY margin and safeZ, including Resume return segments. Named potential overlaps block approval. This conservative check is not swept cutter/holder collision certification and can flag paths that go around a block. Invalid/unreadable settings fail closed; settings are checked again before execution. Later tool sections still require their actual tool zeros.

Night usability pass: Active, Reusable and Archived projects are logical collections available through Organize project; changing collection preserves source paths, order, fingerprints and settings. It is not confirmation of completed machining. Speed settings open before compilation; Preview invokes the reviewed-source compiler and existing optimizer with processing feedback. File selection collapses to one selected filename button, and tapping it reopens the picker. Ordinary numeric dialog Enter dismisses the keyboard without submitting; main-screen coordinate Move remains explicit through the original guards.

Legacy archives: choose one preserved file, review its original path/size/SHA-256, then explicitly Restore copy. The service validates the manifest and checksum, requires no running/paused job, refuses symlink/path escapes and existing destinations, and retains the archive. Restoring does not stage/start a program or restore machine references. Quarantined files retain their original path and remain blocked from staging.

Desktop workspace: at dashboard widths of at least1200px, Files/Projects is below the central pendant controls; Machine and Keep-outs are left; Console, Steppers and collapsed Macros are right. Routine overview fits one browser height; large lists, expanded help/macros and logs can scroll within their panels. The redundant pendant host toolbar and Upload & Print are hidden. Original Mainsail branding, emergency stop, notifications, settings and power controls occupy the left sidebar via CSS positioning; their original handlers remain. Standard dashboard is available from a sidebar link at /?standard=1. On smaller/Android views and non-dashboard routes, the native header and compact pendant navigation remain. No controller restart is needed.

The status says Not homed when Klipper is Ready but any X/Y/Z homing reference is missing. Running/Paused/controller-stop states retain priority. Ready still does not mean a selected job has passed verification.


## Batch posts and printable setup sheets

New Outbox batches group by their embedded batch ID, so repeated posts of the same document on the same day remain separate. Files are initially ordered by stage number, including tools that return later. Missing/duplicate/conflicting stages are reported; an incomplete new batch cannot be saved as a complete project. Refresh after all transfers finish. The operator can still review membership and change stage order after the batch arrives.

Open a group or saved project and choose **Setup sheet** in its heading. A separate printable tab shows operation-by-operation Fusion times, tool identity and geometry, requested RPM, cutting feed, source hashes, stock/travel metadata and consolidated output path. Print / Save PDF uses the browser print dialog. The sheet follows the currently displayed stage selection/order; unchecked review confirmation labels it DRAFT. Legacy files remain supported and explicitly show missing Fusion estimates/geometry instead of invented values. Saved project readback verifies the source bytes before enabling the sheet.

The sheet documents original Fusion operations. Its nominal estimates exclude manual pauses and tool changes, acceleration/controller effects, and subsequent Pendant travel optimization. Requested RPM is not an actual router dial setting or automatic spindle control. The sheet is not verification approval; existing stage/verify/start guards are unchanged. No source is moved or archived by creating a sheet.
