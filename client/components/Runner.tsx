import { Fragment, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";
import { SPEED } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import { debug } from "../util/debug.ts";

export const Runner = (
  { path, slows, onFinish, onSlow }: {
    path: Point[];
    slows: { time: number; thunder: Point }[];
    onFinish: () => void;
    onSlow: (thunder: Point) => void;
  },
) => {
  const start = useRef(Date.now()).current;
  const [loc, setLoc] = useState(path[0]);
  const [slowed, setSlowed] = useState(false);

  useEffect(() => {
    let animationFrame: number;
    let coveredDistance = 0;
    let pathIndex = 0;
    let pathDistance = 0;
    let last = start;
    let nextSlow = 0;

    const cb = () => {
      animationFrame = requestAnimationFrame(cb);

      const now = Date.now();
      const delta = now - last;
      last = now;
      const time = (now - start) / 1_000;

      // Off by 1 error
      for (
        ;
        nextSlow < slows.length && slows[nextSlow].time < time;
        nextSlow++
      ) {
        onSlow(slows[nextSlow].thunder);
      }
      const isSlowed = nextSlow > 0 && (slows[nextSlow - 1].time) + 6 > time;
      setSlowed(isSlowed);

      const speed = isSlowed ? SPEED / 2 : SPEED;

      pathDistance += delta / 1_000 * speed;

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

      if (pathIndex === path.length - 1) return onFinish();
    };

    cb();

    return () => cancelAnimationFrame(animationFrame);
  }, []);

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
