import { signal } from "@preact/signals";

// Bumped once each time the build countdown crosses a ripple mark (see
// TimerRipple). The wave overlay is the authority — it owns the mark detection —
// and the timer button reads this to play its "drop" animation in sync, so the
// button reads as the source of the wave rather than two effects firing near
// each other. A monotonic counter, not a boolean: each increment is a distinct
// drop the button restarts from.
export const timerPulse = signal(0);
