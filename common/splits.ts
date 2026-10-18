// Splits: the time at every meaningful point along one run's route, read
// against the player's best run on the same board.
//
// Computed entirely from a solved path with `pathTimeline`, the walk behind
// `pathDuration`, so a split time can't disagree with the run's stored time and
// needs no server data.
//
// Three kinds of mark, in crossing order:
//   - `slow`       a thunder trigger (the day's and the player's; `local` says
//                  which). The tape labels it by the PIECE ("Thunder 2"), since
//                  that is what the number counts; "slow" never appears in copy
//                  (see the i18n glossary).
//   - `checkpoint` the one fixed waypoint every route must touch.
//   - `flag`       a player-placed manual checkpoint. Flags belong to the
//                  board, not a run, so a flag compares across every build.

import { circleWindows, pathTimeline } from "./pathing.ts";
import type { Point } from "./types.ts";

// How close the runner must pass a flag's cell centre to trip it: half a cell,
// so the runner's own square covers the centre. Decides WHETHER a flag was
// passed; `closestApproach` decides when.
export const FLAG_RADIUS = 0.5;

export type SplitKind = "slow" | "checkpoint" | "flag";

export type Split = {
  kind: SplitKind;
  // 1-based ordinal WITHIN the kind, ordered by first crossing. It names the
  // PIECE, not the event: every trigger of one thunder, and both passes of one
  // flag, carry the same number.
  index: number;
  // Identity across runs of the SAME board, so a delta pairs like with like:
  // the piece's cell plus which of its own crossings this is. An ordinal alone
  // would pair unrelated flags when a build routes the runner differently.
  key: string;
  // Absolute time, at the two decimals the game stores.
  time: number;
  // The board cell this mark belongs to (thunder/flag anchor or checkpoint),
  // for the hover highlight.
  at: Point;
  // Slows only: the thunder is the player's, not the day's.
  local?: boolean;
  // Slows only; 0 when nothing was lost. FINISH seconds this trigger cost by
  // landing on a still-running slow (or the runner finishing with slow owed).
  // See `wastedFinishSeconds`.
  wasted?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where along the path (in distance) the runner comes CLOSEST to (cx, cy),
 * searching only `[from, to]`: one pass of a flag.
 *
 * That instant, not entry into FLAG_RADIUS, is when a flag is passed. Timing
 * the entry made a flag ON the checkpoint read half a cell early (0.2s at half
 * speed) against the checkpoint's own mark.
 */
const closestApproach = (
  path: ReadonlyArray<Readonly<Point>>,
  cum: ReadonlyArray<number>,
  cx: number,
  cy: number,
  from: number,
  to: number,
) => {
  let at = from;
  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const segmentStart = cum[i - 1];
    const segmentEnd = cum[i];
    const length = segmentEnd - segmentStart;
    if (length === 0 || segmentEnd <= from || segmentStart >= to) continue;
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    // The perpendicular foot, clamped to the part of this segment inside the
    // pass, so a nadir outside the window can't be picked.
    const u = ((cx - path[i - 1].x) * dx + (cy - path[i - 1].y) * dy) /
      (dx * dx + dy * dy);
    const candidate = Math.min(
      Math.max(segmentStart + u * length, Math.max(segmentStart, from)),
      Math.min(segmentEnd, to),
    );
    const t = (candidate - segmentStart) / length;
    const distance = (path[i - 1].x + dx * t - cx) ** 2 +
      (path[i - 1].y + dy * t - cy) ** 2;
    if (distance < nearest) {
      nearest = distance;
      at = candidate;
    }
  }
  return at;
};

// A wasted second of SLOW costs half a second of finish time: a slowed second
// covers the SPEED/2 of distance that takes half a second at full speed. The
// tape shows the finish-time figure.
const wastedFinishSeconds = (wastedSlow: number) => wastedSlow / 2;

/**
 * Every mark of one run, in crossing order, numbered per kind.
 *
 * `thunders` is every thunder on the board (`local` marks the player's), the
 * same list `pathDuration` gets, so the slows here are the run's slows.
 * `flags` are the player's manual checkpoints as board cells.
 */
export const computeSplits = (
  { path, thunders, checkpoint, flags = [] }: {
    path: ReadonlyArray<Readonly<Point>>;
    thunders: ReadonlyArray<Readonly<Point & { local?: boolean }>>;
    checkpoint: Point;
    flags?: ReadonlyArray<Readonly<Point>>;
  },
): Split[] => {
  if (path.length < 2) return [];
  const timeline = pathTimeline(path, thunders);
  const cum = timeline.cum;

  // Raw times, so display rounding can't reorder marks a thousandth apart.
  const marks: (Omit<Split, "index" | "time" | "key"> & {
    raw: number;
    // Which crossing of this piece this is (1-based); half of the `key`.
    nth: number;
  })[] = [];

  const crossings = new Map<string, number>();
  const nextNth = (key: string) => {
    const n = (crossings.get(key) ?? 0) + 1;
    crossings.set(key, n);
    return n;
  };

  for (const slow of timeline.slows) {
    const cell = `${slow.thunder.x},${slow.thunder.y}`;
    marks.push({
      kind: "slow",
      raw: slow.time,
      nth: nextNth(`s:${cell}`),
      at: slow.thunder,
      local: thunders.some((t) =>
        t.x === slow.thunder.x && t.y === slow.thunder.y && t.local
      ),
      wasted: round2(wastedFinishSeconds(slow.wasted)),
    });
  }

  // The checkpoint is a path node (both legs meet there), so its distance is
  // that node's.
  const cpNode = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
  const cpIndex = path.findIndex((p) =>
    Math.abs(p.x - cpNode.x) < 1e-9 && Math.abs(p.y - cpNode.y) < 1e-9
  );
  if (cpIndex > 0) {
    marks.push({
      kind: "checkpoint",
      raw: timeline.timeAt(cum[cpIndex]),
      nth: 1,
      at: checkpoint,
    });
  }

  for (const flag of flags) {
    const cell = `${flag.x},${flag.y}`;
    // One mark per pass: a flag near the checkpoint is crossed on both legs.
    for (
      const [start, end] of circleWindows(
        path,
        cum,
        flag.x,
        flag.y,
        FLAG_RADIUS,
      )
    ) {
      marks.push({
        kind: "flag",
        raw: timeline.timeAt(
          closestApproach(path, cum, flag.x, flag.y, start, end),
        ),
        nth: nextNth(`f:${cell}`),
        at: flag,
      });
    }
  }

  // Array.sort is stable, so simultaneous marks keep push order (slows,
  // checkpoint, flags).
  marks.sort((a, b) => a.raw - b.raw);

  // Ordinals are per PIECE, given at its first crossing and reused after.
  const counts = { slow: 0, checkpoint: 0, flag: 0 };
  const ordinals = new Map<string, number>();
  const ordinal = (kind: SplitKind, cell: string) => {
    const id = `${kind}:${cell}`;
    let n = ordinals.get(id);
    if (n === undefined) ordinals.set(id, n = ++counts[kind]);
    return n;
  };
  return marks.map((mark) => ({
    kind: mark.kind,
    index: ordinal(mark.kind, `${mark.at.x},${mark.at.y}`),
    key: `${mark.kind[0]}:${mark.at.x},${mark.at.y}:${mark.nth}`,
    time: round2(mark.raw),
    at: mark.at,
    ...(mark.kind === "slow" ? { local: mark.local, wasted: mark.wasted } : {}),
  }));
};

/**
 * This run's marks against the reference (the player's best) run's, paired by
 * `key`, never by ordinal: the 3rd flag of one run may be a different flag
 * entirely.
 *
 * Higher is better, so a POSITIVE delta is a gain. A mark with no counterpart
 * gets no delta (the tape shows a dash).
 */
export const splitDeltas = (
  splits: ReadonlyArray<Split>,
  reference: ReadonlyArray<Split>,
): (Split & { delta?: number })[] => {
  const by = new Map(reference.map((s) => [s.key, s.time]));
  return splits.map((split) => {
    const ref = by.get(split.key);
    return ref === undefined
      ? split
      : { ...split, delta: round2(split.time - ref) };
  });
};
