import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Point } from "../../common/types.ts";

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
    const cb = () => {
      animationFrame = requestAnimationFrame(cb);

      const p = (Date.now() - start) / 1_000 / duration;
      if (p > 1) return onFinish();

      const i = Math.floor(p * path.length);
      const r = p * path.length - i;

      setLoc({
        x: path[i].x * (1 - r) + (path[i + 1]?.x ?? path[i].x) * r,
        y: path[i].y * (1 - r) + (path[i + 1]?.y ?? path[i].y) * r,
      });
    };

    cb();

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <circle
      cx={loc.x + 0.5}
      cy={loc.y + 0.5}
      r={0.45}
      fill="hsl(300, 60%, 60%)"
      stroke="black"
      stroke-width={0.1}
    />
  );
};
