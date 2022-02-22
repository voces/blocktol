import { Fragment, h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { SPEED } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import { debug } from "../util/debug.ts";

export const Runner = (
  { path, duration, onFinish }: {
    path: Point[];
    duration: number;
    onFinish: () => void;
  },
) => {
  const start = useRef(Date.now()).current;
  const [loc, setLoc] = useState(path[0]);

  useEffect(() => {
    let animationFrame: number;
    const totalDistance = duration * SPEED;
    let coveredDistance = 0;
    let pathIndex = 0;

    const cb = () => {
      animationFrame = requestAnimationFrame(cb);

      const pathPercent = (Date.now() - start) / 1_000 / duration;
      if (pathPercent >= 1) return onFinish();

      let distanceRemaining = pathPercent * totalDistance - coveredDistance;
      while (pathIndex < path.length - 2) {
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
        fill="var(--runner)"
        stroke="var(--maze-stroke)"
        stroke-width={0.1}
      />
      {debug && path.map((loc) => (
        <circle
          key={`${loc.x}-${loc.y}`}
          cx={loc.x + 0.5}
          cy={loc.y + 0.5}
          r={0.05}
        />
      ))}
    </>
  );
};
