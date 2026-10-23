# CNC Outbox helper v1 — Windows

Runs silently after Windows sign-in, independently of Fusion. Requires Python 3.10+ with tkinter/pythonw for the optional status window and Windows PowerShell for notifications. No third-party Python packages. Runs as the signed-in user, without administrator privileges.

Fusion must post to a dedicated **Outbox** folder. Existing NC Programs files are not swept up. Every 3 seconds the helper scans supported G-code extensions; a file must remain unchanged for 10 seconds before transfer. Typical delay is 10–15 seconds plus network and checksum time. Files above 64 MiB remain queued with an error.

Files upload to Moonraker's `gcodes/Inbox`. A hash suffix prevents overwriting other versions. The helper downloads the received file, verifies SHA-256, confirms the PC source has not changed, and moves the PC original into **Sent/YYYY-MM-DD** with a timestamp and transfer receipt. Reposts never overwrite earlier archives. Nothing is started, staged, optimized, or deleted automatically. Project grouping/reordering is a separate future feature.

If the Pi is unreachable and a newly posted file is waiting, a Windows balloon notification appears once for the outage. Retries back off to at most once per minute. No success/recovery pop-ups. Windows notification settings or Focus Assist can suppress balloons. Other errors appear in the status window and rotating log. Files remain in Outbox until verified. The helper keeps retrying while Windows is awake and the user session is running; after sleep/sign-out it resumes at next launch/sign-in.

## Install

Run `install.ps1` with `-Python`, `-InstallDir`, `-Outbox`, `-Sent`, and optionally `-Server`. Inspect the script first. The installer adds **CNC Outbox Helper** to your user's Windows Startup folder and **CNC Outbox Status** to the desktop. Close the status window freely; background transfers continue.

Configure only a trusted LAN Moonraker URL in `config.json`. This version uses Moonraker's existing trusted-client authorization and does not disable authentication or store credentials. If authentication is required, transfers stay queued; authenticated setup is not implemented in v1.

## Stop / uninstall / recover

Create an empty file named `STOP` in the installation directory; the worker exits after any current request completes (up to 30 seconds per request). Remove the user's **CNC Outbox Helper.lnk** from Windows Startup to prevent future launches. To restart, remove STOP and open that Startup shortcut. Edit config only while stopped. Do not run two helpers against the same outbox; a local port lock prevents duplicate instances on this PC.

Uninstalling shortcuts does not delete Outbox, Sent, Pi Inbox or receipts. No automatic archive pruning. To resend a program, copy an archived G-code file back into Outbox. Identical bytes/name reuse an existing matching Pi inbox item; if that item was moved into a project, a new inbox copy is uploaded. A Pi reboot during an unacknowledged upload is handled by checking the content-addressed destination on retry.
