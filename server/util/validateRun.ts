import { cachedSolver, pathDuration, type Slow } from "../../common/pathing.ts";
import type { Point } from "../../common/types.ts";

export type ValidationBlock = Point & { thunder?: boolean | undefined };

// The fields of an iteration a run is validated against. `blocks` is its fixed
// pieces, thunders flagged.
export type IterationShape = {
  bricks: number;
  power: number;
  checkpoint: Point;
  blocks: ValidationBlock[];
};

// The placeable range of a piece's anchor (top-left cell). A piece covers 2×2
// and the interior is cells 1..18 (0 and 19 are the border ring), so anchors
// 1..17 keep the footprint inside. Matches the client's clamp (useInputStart)
// and is shared with the zod piece schema (routes/iteration/run/piece.ts).
export const PIECE_MIN = 1;
export const PIECE_MAX = 17;

const onBoard = (n: number) =>
  Number.isInteger(n) && n >= PIECE_MIN && n <= PIECE_MAX;

export type RunValidation =
  | { ok: true; duration: number; slows: Slow[]; path: Point[] }
  | {
    ok: false;
    reason: "too many blocks" | "too many slows" | "invalid path";
  };

// The single source of truth for whether a placement is a legal run and, if so,
// the canonical time it produces. The write path (updateRun) and
// scripts/auditRuns.ts both use it so they can't drift: `duration` is what gets
// persisted.
export const validateRun = (
  iteration: IterationShape,
  playerBlocks: ValidationBlock[],
): RunValidation => {
  if (playerBlocks.length > iteration.bricks) {
    return { ok: false, reason: "too many blocks" };
  }
  if (playerBlocks.filter((b) => b.thunder).length > iteration.power) {
    return { ok: false, reason: "too many slows" };
  }

  // Defense in depth behind the zod schema: the solver indexes `grid[y][x]`, and
  // a fractional or off-board coordinate reads `undefined` there, i.e. FREE, so
  // a piece would land in the border or half-overlap another (and serializeRun
  // would write 4.5,4 as "4.54"). Overlap among whole, on-board anchors and
  // with the day's pieces / checkpoint is the solver's job, below.
  if (!playerBlocks.every((b) => onBoard(b.x) && onBoard(b.y))) {
    return { ok: false, reason: "invalid path" };
  }

  let path: Point[] | undefined;
  try {
    // Throws when a piece is out of bounds or overlaps another (the player's or
    // the iteration's). A bad base board throws in the PathSolver constructor
    // and lands here too, before anything is cached. cachedSolver reuses one
    // base precompute across all validations of the same iteration.
    path = cachedSolver(iteration.blocks, iteration.checkpoint)
      .solve(playerBlocks);
  } catch {
    return { ok: false, reason: "invalid path" };
  }
  if (!path) return { ok: false, reason: "invalid path" };

  const [duration, slows] = pathDuration(path, [
    ...iteration.blocks.filter((b) => b.thunder),
    ...playerBlocks.filter((b) => b.thunder),
  ]);
  return { ok: true, duration, slows, path };
};
