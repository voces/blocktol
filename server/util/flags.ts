import { Point } from "../../common/types.ts";

// A player's flags on one board, stored in a single column like a run's maze
// (util/run.ts): one line per flag, `xxyy`, each coordinate zero-padded.
export const serializeFlags = (flags: ReadonlyArray<Point>) =>
  flags.map((f) =>
    `${f.x.toString().padStart(2, "0")}${f.y.toString().padStart(2, "0")}`
  ).join("\n");

export const deserializeFlags = (data: string): Point[] =>
  data.split("\n").filter((r) => r.length === 4).map((r) => ({
    x: parseInt(r.slice(0, 2)),
    y: parseInt(r.slice(2)),
  }));
