# Scheduled backup admission and Pendant prompt

The optional `tools/backup_idle_guard.py` integrates with an existing scheduled backup runner. It is not installed by the web installer and does not create a backup schedule. The runner must hold its backup lock, invoke this guard before heavy work, treat exit 75 as deferred, and preserve the existing last-success timestamp on deferral. Only exit 0 admits a backup; unexpected errors must not admit one.

The guard uses local Moonraker HTTP read-only printer status and shared database namespace `cnc_maintenance`. It never sends machine commands. Database keys are `backup_activity`, `backup_prompt`, and `backup_choice`. Confirm localhost access permissions for the target installation; do not bypass authentication.

Running/paused jobs, active file execution, unavailable status and queued/recent motion defer silently. Motion must be quiet for at least 30 seconds. When otherwise idle, Pendant interaction or machine motion in the previous 15 minutes requests a decision. The scheduler waits up to 60 seconds, checking machine status every three seconds. No answer, operator deferral or a job starting while waiting defers the attempt. Old answers cannot admit a newer request. After deferral, repeated questions are suppressed until activity has been quiet for 15 minutes.

The Pendant records trusted pointer/keyboard activity at most once every 30 seconds and checks pending questions at most every five seconds while idle, using its existing status event. It does not open a question over another modal or during active jobs. Choices are Defer until finished and Back up now. Server checks remain authoritative. Refresh after deploying the new asset. An old/closed browser cannot answer; a pending request then defers.

`--check-only` validates live status without creating a question, changing database values or invoking a backup. Test scheduling and UI with mocks before deployment. Keep verified originals and hashes for both the scheduler guard and UI dependencies. This addition does not implement overdue/failure notifications or recover machine position.

Admission is not a continuous execution interlock: a job can start after the guard returns success. The existing runner may use lower CPU/I/O priority, but that does not guarantee timing or prevent disk contention. Further coordination is required to avoid all backup/job overlap. Native Mainsail interactions outside Pendant are not recorded as Pendant activity; recent machine motion is recognized independently.
