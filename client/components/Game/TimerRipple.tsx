import { Fragment, h } from "preact";
import {
  createPortal,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/compat";
import { GameStateContext } from "./useGameState.ts";

/**
 * Soft time-passing cue for the build window. Players heads-down on the board
 * lose track of the 60s clock, so the timer pill emits a mild blue ripple as
 * the countdown crosses set marks — a felt nudge, not an alarm. The ripple is
 * rendered viewport-fixed over the pill's measured box (the same escape hatch
 * the celebration overlay uses in RunClock), because `.game` clips its overflow
 * and a ring spreading past the top-right corner would otherwise be cut off.
 *
 * Marks descend so a single pass down the clock fires each once; the closing
 * seconds cluster (5/3/2/1) so the pulse quickens as the window runs out. Only
 * during a live `building` countdown — staged/viewing/running are inert here.
 */
const RIPPLE_MARKS = [30, 15, 10, 5, 3, 2, 1];

type Ripple = { id: number; rect: DOMRect; urgent: boolean };

export const TimerRipple = () => {
  const { time, phase } = useContext(GameStateContext);
  const [ripples, setRipples] = useState<Ripple[]>([]);
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
    // marks in one tick; one ripple for the batch is deliberate (mild).
    const mark = RIPPLE_MARKS.find((m) => before > m && time <= m);
    if (mark === undefined) return;
    // The one build pill is queried at fire time rather than threaded through a
    // ref — there's only ever one, and its box is measured fresh so the ripple
    // lands on it wherever layout has put it.
    const pill = document.querySelector(".hud__build");
    if (!pill) return;
    setRipples((rs) => [
      ...rs,
      {
        id: nextId.current++,
        rect: pill.getBoundingClientRect(),
        urgent: mark <= 5,
      },
    ]);
  }, [time, phase]);

  const remove = (id: number) =>
    setRipples((rs) => rs.filter((r) => r.id !== id));

  if (ripples.length === 0) return null;
  return createPortal(
    <Fragment>
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          class={"timer-ripple" + (r.urgent ? " timer-ripple--urgent" : "")}
          style={{
            top: `${r.rect.top}px`,
            left: `${r.rect.left}px`,
            width: `${r.rect.width}px`,
            height: `${r.rect.height}px`,
          }}
          onAnimationEnd={() => remove(r.id)}
        />
      ))}
    </Fragment>,
    document.body,
  );
};
