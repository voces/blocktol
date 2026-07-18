import { h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";

/**
 * Water-ripple time cue for the build window. Players heads-down on the board
 * lose track of the 60s clock, so at set marks the board's blue surface ripples
 * — as if the timer button in the top-right dropped into the water and a wave
 * raced across it. A felt nudge, not an alarm.
 *
 * The wave is an SVG overlay covering the board square (positioned like the
 * prestart mask, in the board's own 0–20 coordinate space), so a ring can
 * originate at the top-right corner (20,0) — the water nearest the button — and
 * spread clear across to the far corner. Drawn above the pieces at low opacity,
 * so it reads as a wave passing over the surface rather than an object on it.
 *
 * Marks descend so a single pass down the clock fires each once; the closing
 * seconds cluster (5/3/2/1) so the surface stirs more as the window runs out.
 * Only during a live `building` countdown — staged/viewing/running are inert.
 */
const RIPPLE_MARKS = [30, 15, 10, 5, 3, 2, 1];

// A drop throws a short train of rings — the second trailing the first — for a
// wave rather than a lone ring. `animationDelay`s in seconds.
const RINGS = [0, 0.28];

type Wave = { id: number; urgent: boolean };

export const TimerRipple = () => {
  const { time, phase } = useContext(GameStateContext);
  const [waves, setWaves] = useState<Wave[]>([]);
  // Previous observed second, to fire only on a real tick DOWN across a mark —
  // not on the initial mount, nor on the jump back up when a fresh attempt
  // re-arms the clock to 60.
  const prev = useRef(time);
  const nextId = useRef(0);

  useEffect(() => {
    const before = prev.current;
    prev.current = time;
    if (phase !== "building") return;
    if (time >= before) return;
    // Largest mark newly crossed. A throttled background tab can skip several
    // marks in one tick; one wave for the batch is deliberate (mild).
    const mark = RIPPLE_MARKS.find((m) => before > m && time <= m);
    if (mark === undefined) return;
    setWaves((w) => [...w, { id: nextId.current++, urgent: mark <= 5 }]);
  }, [time, phase]);

  const remove = (id: number) => setWaves((w) => w.filter((x) => x.id !== id));

  if (waves.length === 0) return null;
  return (
    <svg class="board-ripple" viewBox="0 0 20 20" aria-hidden="true">
      {waves.map((wave) =>
        RINGS.map((delay, i) => (
          <circle
            key={`${wave.id}-${i}`}
            class={"board-ripple__ring" +
              (wave.urgent ? " board-ripple__ring--urgent" : "")}
            cx={20}
            cy={0}
            r={0}
            style={{ animationDelay: `${delay}s` }}
            // The wave lives until its last (trailing) ring finishes; only that
            // one drives cleanup so the earlier rings aren't cut short.
            onAnimationEnd={i === RINGS.length - 1
              ? () => remove(wave.id)
              : undefined}
          />
        ))
      )}
    </svg>
  );
};
