import { Point } from "./types.ts";

export const gridToString = (
  grid: boolean[][],
  path?: Point[],
  checkpoint?: Point,
) =>
  grid.map((r, y) =>
    r.map((v, x) =>
      ((checkpoint?.x ?? 0) + 0.5 === x && (checkpoint?.y ?? 0) + 0.5 === y)
        ? "×"
        : v
        ? "█"
        : path?.some((p) => p.x === x && p.y === y)
        ? "·"
        : " "
    ).join("")
  ).join("\n");
