# Fusion CNC Outbox

**Post to CNC Outbox** accepts one setup, an NC Program, or selected operations from one setup. It posts separate single-tool files at every consecutive tool change, in the setup's programmed order. A returning tool stays in its later position: T6 → T9 → T13 → T6 creates four files. A single-tool selection creates one file. No operation is reordered to minimize tool changes.

The same command remains pinned in **Milling > Actions**, immediately after native Post Process, and in the CAM right-click menu. No second batch command or toolbar panel is added. After updating installed Python files, Stop and Run CncOutbox once in Scripts and Add-Ins, or restart Fusion after saving your work. Run on Startup can remain enabled.

## Review and posting

Assign the intended machine to the setup. The assigned identity must match the locally registered machine; first binding requires review. Select the intended setup or operations and invoke Post to CNC Outbox. Suppressed operations are omitted. The command rejects mixed setups, invalid/empty toolpaths and more than 24 tool stages before posting. Different tool geometry/definitions cause separate stages even if the tool number is reused. Different feeds or presets for the same tool do not themselves split a stage. Manual NC entries retain sequence, with entries before a new tool attached to that following stage; trailing entries remain in the last stage.

One confirmation lists every stage and its operations. Confirming posts through the usual local CNC Pendant post configuration. Native NC Programs remain in the document as an audit trail. The command does not generate missing toolpaths, modify CAM, start a job or send machine commands.

All native outputs are first created in an unwatched `.cnc-posting/<batch-id>` folder beside Outbox. It retains drafts and a manifest. Only after every post succeeds and passes readback checks are copies released to Outbox, without overwriting existing names. A posting failure publishes nothing; an exceptional failure during publication can leave a partial batch, which Pendant flags as incomplete. Preserve drafts and inspect before retrying. No automatic pruning.

Unique names include document, early stage/tool number, setup, UTC timestamp and random batch suffix. The existing PC helper still uploads files, verifies SHA-256, and archives PC originals with receipts. It may shorten filenames, so Pendant uses embedded batch identity and stage numbers rather than filenames to order the files.

## Embedded setup-sheet metadata

Each G-code starts with `CNC_BATCH_V1` JSON and `CNC_FUSION_OPERATION_V1` JSON comments. These retain document/setup, batch ID, stage/count, operation names, actual assigned Fusion tool definitions, requested RPM, cutting feed and Fusion nominal time when available. Comments cannot add executable lines. The canonical post's original metadata and motion remain intact.

Time estimates use Fusion CAM at 100% feed, a disclosed 1000 mm/min rapid assumption and zero manual tool-change time. These assumptions are for documentation, not configured or validated machine speeds. Missing estimates are explicitly unavailable; they are not guessed. Pendant optimization changes travel timing independently.

## Installation and machine identity

Copy CncOutbox/ into the user's Fusion API AddIns directory. Preserve the private config.json and resources when updating. Configuration requires an absolute Outbox path and the exact local post description, with vendor Mainsail CNC Pendant. The one-tool canonical post remains unchanged. The registered machine identity lives only in local config.json, never public source. Assignment to each setup and actual physical machine/tool clearance remain separate checks.

## Verification status

Batch planning and posting orchestration are tested against a fake Fusion API, including returning tools, setup ordering, preserved Manual NC order, invalid paths and mid-batch native-post failure with no publication. Menu placement regression tests pass. The reference installation has also completed real multi-stage Fusion posting and checksum-verified PC-to-Pi delivery. This does not certify another Fusion installation, CAM strategy, machine assignment or machining result.

## Posting memo and review

CNC Outbox now opens a native command dialog showing Fusion document, setup, local posting time and selected operations in setup order. Optional one-line memo (up to200characters) is embedded in every batch stage and the preserved draft manifest. Post to CNC Outbox is the single normal confirmation; first-time machine identity/copy review remains separate. Suppressed operations remain excluded and the selected tool-change sequence is retained. Reload the add-in after updating it.
