# Recovery and uninstall

UI installation does not alter printer.cfg, service state or machine pins. Use its exact backup directory:

```sh
python3 tools/manage.py uninstall --backup /path/printed/by/installer
python3 tools/manage.py uninstall --backup /path/printed/by/installer --apply
```

The first command is a dry run. Uninstall verifies backup hashes and refuses to overwrite files edited after installation. Restore only managed files; retain unrelated newer configuration. Original full-config and Mainsail database exports remain in the local backup for manual comparison; they are never uploaded by this project.

Optional controller changes are separate: remove only the includes/macros you added, resolve rename_existing wrappers, and remove the optional extension after reviewing dependent macros. Restart Klipper only while idle, then re-home and establish work/tool zeros before machining. Restoring a configuration file cannot restore physical position after a restart or released steppers.

Moonraker's `cnc_pendant` namespace stores shared preferences. Existing keep-outs remain in the reference namespace used by the UI. Uninstall leaves preferences intact intentionally; export them before deleting them manually if desired.

Android uninstall removes its machine-address preference and home-screen app. It does not change the Pi, G-code files or browser access.
