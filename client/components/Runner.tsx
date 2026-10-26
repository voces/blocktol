import { Fragment, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { pairs } from "../../common/arrays.ts";
import { SPEED } from "../../common/pathing.ts";
import { type Point } from "../../common/types.ts";
import { useGame } from "../hooks/useGame.ts";
import { debug } from "../util/debug.ts";
import { runnerTime } from "./Game/interaction.ts";

// Distance is integrated per frame, so a frame must not span a speed change.
// 32ms samples at least as often as a 30fps display; a longer frame (GC pause,
// slow device) is split into chunks that each re-decide whether the runner is
// slowed.
const MAX_STEP_S = 0.032;

export const Runner = (
  { path, slows, onFinish, onSlow, paused }: {
    path: Point[];
    slows: { time: number; thunder: Point }[];
    onFinish: () => void;
    onSlow: (thunder: Point) => void;
    // Holds the walk and its clock; the run resumes at the time it left off.
    // Read through a ref so toggling never restarts the walk.
    paused?: boolean | undefined;
  },
) => {
  const [loc, setLoc] = useState(path[0]);
  const [slowed, setSlowed] = useState(false);
  const game = useGame();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Keyed on the PATH, not just mount: picking another run mid-animation (a
  // review replay) must restart the walk on the new route. The cleanup cancels
  // the pending frame, so an abandoned walk never dispatches its finish.
  useEffect(() => {
    const start = Date.now();
    let animationFrame: number;
    let coveredDistance = 0;
    let pathIndex = 0;
    let pathDistance = 0;
    let last = start;
    let nextSlow = 0;
    // Time not counted against the run (hidden tab, pause). Subtracted from
    // wall-clock rather than summed from frame deltas, so it can't drift.
    let pausedMs = 0;
    let hiddenAt: number | null = null;
    let isSlowed = false;

    // A hidden tab suspends requestAnimationFrame, so the first frame back
    // would carry the whole absence as one delta: every missed thunder firing
    // at once, the span integrated at one speed, and the finish possibly
    // overshot (in free play that commits a run nobody watched). Treat the
    // absence as a pause instead.
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        pausedMs += Date.now() - hiddenAt;
        // Nothing accrued while away, so the next frame starts from here.
        last = Date.now();
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const cb = () => {
      const now = Date.now();
      const frameMs = now - last;
      last = now;

      if (pausedRef.current) {
        pausedMs += frameMs;
        animationFrame = requestAnimationFrame(cb);
        return;
      }

      const time = (now - start - pausedMs) / 1_000;
      // Walk progress (see `runnerTime`). A signal, not a callback prop: it
      // changes every frame and a prop would re-render the tree at that rate.
      runnerTime.value = time;

      // Walk this frame in bounded chunks, each re-deciding whether slowed.
      for (let t = Math.max(0, time - frameMs / 1_000); t < time;) {
        const stepEnd = Math.min(t + MAX_STEP_S, time);
        // Fire every slow that begins before this chunk ends, once each.
        for (
          let slow = slows[nextSlow];
          slow && slow.time < stepEnd;
          slow = slows[++nextSlow]
        ) {
          onSlow(slow.thunder);
        }
        const lastSlow = slows[nextSlow - 1];
        isSlowed = lastSlow !== undefined && lastSlow.time + 6 > stepEnd;
        pathDistance += (stepEnd - t) * (isSlowed ? SPEED / 2 : SPEED);
        t = stepEnd;
      }
      setSlowed(isSlowed);

      let distanceRemaining = pathDistance - coveredDistance;
      while (true) {
        const from = path[pathIndex];
        const to = path[pathIndex + 1];
        if (!from || !to) break; // at the end of the path
        const legDistance = ((to.x - from.x) ** 2 + (to.y - from.y) ** 2) **
          0.5;

        if (legDistance < distanceRemaining) {
          coveredDistance += legDistance;
          distanceRemaining -= legDistance;
          pathIndex++;
          continue;
        }

        const r = distanceRemaining / legDistance;
        setLoc({
          x: from.x * (1 - r) + to.x * r,
          y: from.y * (1 - r) + to.y * r,
        });
        break;
      }

      if (pathIndex === path.length - 1) {
        onFinish();
        game.dispatchEvent("runFinish", { kind: "runFinish" });
        return;
      }

      // Scheduled only while unfinished: queuing before the finish check would
      // re-dispatch runFinish every frame until the parent unmounts this.
      animationFrame = requestAnimationFrame(cb);
    };

    cb();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(animationFrame);
      // A finished or abandoned walk must not leave its time published.
      runnerTime.value = undefined;
    };
  }, [path]);

  return (
    <>
      {loc && (
        <circle
          cx={loc.x + 0.5}
          cy={loc.y + 0.5}
          r={0.45}
          fill={slowed ? "var(--slow-runner)" : "var(--runner)"}
          stroke="var(--maze-stroke)"
          stroke-width={0.1}
        />
      )}
      {debug && path.map((loc) => (
        <circle
          key={`${loc.x}-${loc.y}`}
          cx={loc.x + 0.5}
          cy={loc.y + 0.5}
          r={0.05}
          fill="var(--maze-stroke)"
        />
      ))}
      {debug && [...pairs(path)].map(([prev, loc]) => (
        <line
          key={`${loc.x},${loc.y}-${prev.x},${prev.y}`}
          x1={loc.x + 0.5}
          y1={loc.y + 0.5}
          x2={prev.x + 0.5}
          y2={prev.y + 0.5}
          stroke="var(--maze-stroke)"
          stroke-width={0.02}
        />
      ))}
    </>
  );
};
