# Compatibility

Tested reference: LowRider V4, Mainsail 2.17.0, Klipper/Moonraker, X/Y minimum homing, upward Z homing, paired Y/Y1 and Z/Z1. Browser testing covers desktop and narrow viewports. Android APK is compiled/signature-checked, not yet physically device-tested.

Machine limits are read from Klipper; reference jog rate bases remain XY 200 mm/s and Z 25 mm/s, scaled by the selected percentage. Review these and the safe-Z range before adapting. Some macro names and DOM identifiers retain LowRider naming. Endstop labels assume X/Y/Y1/Z/Z1; adapt to actual switch names.

The normal pendant is mostly coordinate-based, but the **reference homing, pause, LED and recovery macros are machine-specific**. Do not copy a pin, direction, homing order, or dual-motor mapping without review. Normal motion follows Klipper's kinematics; individual-motor forced recovery is available only for Cartesian kinematics and cannot be treated as normal CoreXY motion.

Spindle on/off/RPM and probing are planned; router power is manual in this reference. Keep-out protection applies only to guarded UI moves, not arbitrary programs/macros/homing/console. No claim of universal installation or safety certification is made.
