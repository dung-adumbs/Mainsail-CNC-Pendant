# Shared settings and restart behavior

| Setting | Storage / behavior |
|---|---|
| Units mm/cm/in, jog percentage, Coarse/Fine, Safe Z height and below-safe cap | Moonraker `cnc_pendant` namespace; shared PC/Android, persists on Pi |
| Keep-out definitions/enabled states | Existing Moonraker database storage; reloaded before guarded moves |
| Stepper reminder/disable timing | Klipper save_variables in reference light macros |
| Run speed | Actual Klipper override; M220 wrapper persists it. Restart restores saved percentage capped at 100%; new file start uses current or 100%, whichever is less |
| Below-safe permission | Transient; locked after reload/restart/disconnection, origin changes, safe-height changes and upward crossing of safe height |
| Forced unhomed motion | Transient backend recovery mode; disabled at restart; homing disables it |
| Work/tool zeros and homing | Not assumed valid after restart/stepper release; re-establish physically |
| Full-screen state / PC layout / Android machine address | Device-specific |

Clients poll shared preferences approximately every 1.5 seconds. Different keys are written independently. Remote preferences are deferred while an input is being edited or a jog request is waiting. Latest successful write wins for simultaneous edits of the same setting. There is no multi-operator motion lock: coordinate machine use between operators.

Run speed is not reset by opening a page, refreshing, pausing or resuming. Units change display/entry and normal jog increments; they do not emit G20/G21 or rewrite a job. Internal guarded commands stay millimeters. Safe Z values and rate readouts retain their explicit mm and mm/s labels. Forced recovery remains fixed millimeter increments.
