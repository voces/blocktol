import { Point } from "../../common/types.ts";

// A player's flags on one board, stored as a single column the way a run's maze
// is (see util/run.ts): one fixed-width record per line. Flags are plain cells —
// no kind, no order that matters — so a record is just the two coordinates,
// zero-padded so the pair is unambiguous.
export const serializeFlags = (flags: ReadonlyArray<Point>) =>
  flags.map((f) =>
    `${f.x.toString().padStart(2, "0")}${f.y.toString().padStart(2, "0")}`
  ).join("\n");

export const deserializeFlags = (data: string): Point[] =>
  data.split("\n").filter((r) => r.length === 4).map((r) => ({
    x: parseInt(r.slice(0, 2)),
    y: parseInt(r.slice(2)),
  }));
