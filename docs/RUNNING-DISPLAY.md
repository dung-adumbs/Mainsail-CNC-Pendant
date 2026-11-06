# Running display

Progress has a fixed column and tabular digits so changing speed strings cannot shift it. The second line reports current Klipper session maximum velocity, acceleration, square-corner velocity and minimum cruise ratio. Values come from the existing status stream; no extra poll is introduced. Missing/unready values appear unavailable.

These configured limits do not predict actual speed or prove safe machine settings. Live speed is planned toolhead velocity, not an encoder reading. Programmed feed reflects parsed G-code and may be ahead of physical motion because of buffering. Run speed override is shown separately. Pendant displays approximate scheduled motion ahead from Klipper timing; it is not an exact command count or guaranteed stop delay.

Tests cover speed distinctions, current limits, disconnected clearing, progress position through100%, and narrow layouts. Actual operation remains subject to operator review.

Operator refinements: job headings show Fusion document, setup and memo together; completed staged programs use Re-run. Pause waits for fresh verification before showing a failure. Tool-change Resume requires explicit acknowledgement when work Z offset is unchanged or unknown. Dial suggestions come from the machine's shared routerDialMap preference and remain estimates. Machine > Velocity display selects per second (default) or per minute; display/input conversion does not change native API units, G-code or saved rates. Acceleration remains mm/s². Buffer queue is estimated queued-motion time, not a disk queue or exact pause delay.
