import { signal } from "@preact/signals";

// Bumped each time the build countdown crosses a ripple mark (see TimerRipple,
// which owns the mark detection). The timer button reads it to play its "drop"
// animation in sync with the wave. A counter, not a boolean: each increment is
// a distinct drop the button restarts from.
export const timerPulse = signal(0);
