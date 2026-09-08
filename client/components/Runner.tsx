import { Fragment, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { SPEED } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import { useGame } from "../hooks/useGame.ts";
import { debug } from "../util/debug.ts";
import { runnerTime } from "./Game/interaction.ts";

// Distance is integrated forward from each frame's elapsed time, so one frame
// must never cover enough ground for the runner's speed to have changed inside
// it. At 32ms the walk is sampled at least as often as a 30fps display, and a
// frame that runs long (a GC pause, a slow device, a tab handed back) is split
// into chunks that each re-decide whether the runner is slowed.
const MAX_STEP_S = 0.032;

export const Runner = (
  { path, slows, onFinish, onSlow, paused }: {
    path: Point[];
    slows: { time: number; thunder: Point }[];
    onFinish: () => void;
    onSlow: (thunder: Point) => void;
    // Holds the walk where it stands, and holds its clock with it — the run
    // resumes at the time it left off rather than at wall-clock. Read through a
    // ref below so toggling it never restarts the walk.
    paused?: boolean;
  },
) => {
  const [loc, setLoc] = useState(path[0]);
  const [slowed, setSlowed] = useState(false);
  const game = useGame();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Keyed on the PATH, not just mount: picking another run while one is
  // animating (a review replay) swaps the prop, and the walk has to start over
  // on the new route — otherwise the runner carries on travelling the maze you
  // left. The cleanup cancels the pending frame, so the abandoned walk also
  // never reaches its finish dispatch. `run` only changes when setRun is called,
  // so an ordinary re-render can't restart the animation.
  useEffect(() => {
    const start = Date.now();
    let animationFrame: number;
    let coveredDistance = 0;
    let pathIndex = 0;
    let pathDistance = 0;
    let last = start;
    let nextSlow = 0;
    // Time the run is NOT accountable for: a hidden tab, or an explicit pause.
    // Subtracted from wall-clock rather than summed from frame deltas, so the
    // clock stays exact instead of drifting over a long walk.
    let pausedMs = 0;
    let hiddenAt: number | null = null;
    let isSlowed = false;

    // A hidden tab suspends requestAnimationFrame outright — it is not merely
    // throttled — so the first frame back would otherwise carry the whole
    // absence as one delta: every thunder passed meanwhile firing at once, and
    // the entire span integrated at whichever speed happened to be current when
    // the tab went away. The runner then lands somewhere its own clock never put
    // it, and can overshoot the finish (which, in free play, commits and
    // re-stages a run nobody watched). Treat the absence as a pause instead: the
    // walk holds, and resumes where it stood.
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
      // How far into the walk we are, for anything that wants to keep pace with
      // the runner (the splits tape lights the mark it has just reached). A
      // signal rather than a callback prop: this fires every frame, and a
      // prop threaded through Board would re-render the tree at that rate.
      runnerTime.value = time;

      // Walk this frame in bounded chunks, each re-deciding whether the runner
      // is slowed, so a long one can't be applied at a single speed sample.
      for (let t = Math.max(0, time - frameMs / 1_000); t < time;) {
        const stepEnd = Math.min(t + MAX_STEP_S, time);
        // Off by 1 error
        for (
          ;
          nextSlow < slows.length && slows[nextSlow].time < stepEnd;
          nextSlow++
        ) {
          onSlow(slows[nextSlow].thunder);
        }
        isSlowed = nextSlow > 0 && (slows[nextSlow - 1].time) + 6 > stepEnd;
        pathDistance += (stepEnd - t) * (isSlowed ? SPEED / 2 : SPEED);
        t = stepEnd;
      }
      setSlowed(isSlowed);

      let distanceRemaining = pathDistance - coveredDistance;
      while (pathIndex < path.length - 1) {
        const legDistance = ((path[pathIndex + 1].x - path[pathIndex].x) ** 2 +
          (path[pathIndex + 1].y - path[pathIndex].y) ** 2) ** 0.5;

        if (legDistance < distanceRemaining) {
          coveredDistance += legDistance;
          distanceRemaining -= legDistance;
          pathIndex++;
          continue;
        }

        const r = distanceRemaining / legDistance;
        setLoc({
          x: path[pathIndex].x * (1 - r) +
            (path[pathIndex + 1]?.x ?? path[pathIndex].x) * r,
          y: path[pathIndex].y * (1 - r) +
            (path[pathIndex + 1]?.y ?? path[pathIndex].y) * r,
        });
        break;
      }

      if (pathIndex === path.length - 1) {
        onFinish();
        game.dispatchEvent("runFinish", { kind: "runFinish" });
        return;
      }

      // Scheduled only while unfinished — previously the next frame was queued
      // before the finish check, so finishing depended on the parent unmounting
      // this component before that frame fired; anything deferring that render
      // would have re-dispatched runFinish (and its startRun) every frame.
      animationFrame = requestAnimationFrame(cb);
    };

    cb();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(animationFrame);
      // No runner, no progress — a finished or abandoned walk must not leave a
      // mark lit on the tape.
      runnerTime.value = undefined;
    };
  }, [path]);

  return (
    <>
      <circle
        cx={loc.x + 0.5}
        cy={loc.y + 0.5}
        r={0.45}
        fill={slowed ? "var(--slow-runner)" : "var(--runner)"}
        stroke="var(--maze-stroke)"
        stroke-width={0.1}
      />
      {debug && path.map((loc) => (
        <circle
          key={`${loc.x}-${loc.y}`}
          cx={loc.x + 0.5}
          cy={loc.y + 0.5}
          r={0.05}
          fill="var(--maze-stroke)"
        />
      ))}
      {debug && path.map((loc, i) =>
        i > 0 && (
          <line
            key={`${loc.x},${loc.y}-${path[i - 1].x},${path[i - 1].y}`}
            x1={loc.x + 0.5}
            y1={loc.y + 0.5}
            x2={path[i - 1].x + 0.5}
            y2={path[i - 1].y + 0.5}
            stroke="var(--maze-stroke)"
            stroke-width={0.02}
          />
        )
      )}
    </>
  );
};
