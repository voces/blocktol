// Splits: the speedrunning-style breakdown of one run — the time at every
// meaningful point along the runner's route, read against the player's best run
// on the same board.
//
// Pure and framework-free (it lives in `common/` for that reason), and computed
// entirely from a solved path: the client already re-solves any maze with the
// shared engine, so a split needs no new data from the server and no new
// timing model. Everything here is derived from `pathTimeline`, the same walk
// `pathDuration` reports through, so a split time and the run's stored time can
// never disagree.
//
// Three kinds of mark, in crossing order:
//   - `slow`       — a thunder trigger (the day's pieces and the player's
//                    alike; `local` says which, so the tape can colour it with
//                    the board's own tokens). Internal name: the tape labels it
//                    by the PIECE ("Thunder 2"), since that is what the number
//                    counts, and "slow" never appears in copy (see the i18n
//                    glossary).
//   - `checkpoint` — the one fixed waypoint every route must touch.
//   - `flag`       — a player-placed marker, the manual checkpoint. Flags
//                    belong to the board, not to a run, so the same flag is
//                    comparable across every build of that board.

import { circleWindows, pathTimeline } from "./pathing.ts";
import type { Point } from "./types.ts";

// How close the runner must pass a flag's cell centre to trip it. Half a cell,
// i.e. the runner's own square has to cover the centre — the same "strictly
// inside the circle" test a thunder's radius uses, just much smaller.
export const FLAG_RADIUS = 0.5;

export type SplitKind = "slow" | "checkpoint" | "flag";

export type Split = {
  kind: SplitKind;
  // 1-based ordinal WITHIN the kind, ordered by first crossing — the tape's
  // "Slow 3". It names the PIECE, not the event: one thunder can trigger a
  // dozen times and one flag can be crossed twice (once per leg), and every one
  // of those rows carries the same number, because it is the same flag. The
  // times down the column are what tell the passes apart.
  index: number;
  // Identity of this mark across runs of the SAME board, so a delta pairs like
  // with like: the piece's cell plus which of its own crossings this is. An
  // ordinal alone would pair a flag against an unrelated one whenever a build
  // routes the runner differently.
  key: string;
  // Absolute time, at the two decimals the game stores.
  time: number;
  // The board cell this mark belongs to (the thunder/flag anchor, or the
  // checkpoint), for the board highlight a hovered row draws.
  at: Point;
  // Slows only: the thunder is the player's, not the day's.
  local?: boolean;
  // Slows only, and 0 when nothing was lost: FINISH seconds this trigger cost
  // by landing on a still-running slow (or by the runner finishing with slow
  // owed). See `wastedFinishSeconds`.
  wasted?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// A wasted second of SLOW is not a wasted second of finish time: while slowed
// the runner covers half the ground, so a second of slow is worth SPEED/2 of
// distance it would otherwise have crossed in half a second. Losing a second of
// slow therefore costs half a second of finish time — the figure the tape shows,
// because the tape is about the clock.
const wastedFinishSeconds = (wastedSlow: number) => wastedSlow / 2;

/**
 * Every mark of one run, in crossing order, numbered per kind.
 *
 * `thunders` is every thunder on the board (fixed and player-placed, `local`
 * marking the player's) — the same list `pathDuration` is given, so the slows
 * here ARE the run's slows. `flags` are the player's manual checkpoints as
 * board cells.
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

  // Raw (unrounded) times so ordering can't be perturbed by the display
  // rounding two marks a thousandth apart would share.
  const marks: (Omit<Split, "index" | "time" | "key"> & {
    raw: number;
    // Which crossing of this particular piece this is (1-based) — the other
    // half of the mark's cross-run key.
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

  // The checkpoint is a node of the path by construction (the search is rooted
  // there and both legs meet at it), so its distance is just that node's.
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
    // One mark per pass: a flag near the checkpoint is legitimately crossed on
    // the way out and again on the way back, and each pass is its own split.
    for (
      const [start] of circleWindows(path, cum, flag.x, flag.y, FLAG_RADIUS)
    ) {
      marks.push({
        kind: "flag",
        raw: timeline.timeAt(start),
        nth: nextNth(`f:${cell}`),
        at: flag,
      });
    }
  }

  // Crossing order. Array.sort is stable, so marks that land at the exact same
  // instant keep the order they were pushed in (slows, then the checkpoint,
  // then flags) rather than shuffling between renders.
  marks.sort((a, b) => a.raw - b.raw);

  // Ordinals are per PIECE, handed out in crossing order and then reused for
  // every later crossing of that same piece (see `index`).
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
 * identity — never by ordinal, because a different build routes the runner
 * differently and the 3rd flag of one run may be a different flag entirely.
 *
 * Higher is better in Blocktol, so a POSITIVE delta is a gain. A mark the
 * reference has no counterpart for gets no delta (the tape shows a dash).
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
