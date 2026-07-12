import { cachedSolver, pathDuration, type Slow } from "../../common/pathing.ts";
import type { Point } from "../../common/types.ts";

export type ValidationBlock = Point & { thunder?: boolean };

// The fields of an iteration a run is validated against. `blocks` is the
// iteration's own fixed pieces (both blocks and thunders, thunders flagged).
export type IterationShape = {
  bricks: number;
  power: number;
  checkpoint: Point;
  blocks: ValidationBlock[];
};

export type RunValidation =
  | { ok: true; duration: number; slows: Slow[]; path: Point[] }
  | {
    ok: false;
    reason: "too many blocks" | "too many slows" | "invalid path";
  };

// The single source of truth for whether a player's placement is a legal run,
// and — when it is — the canonical time it produces. Used both on the write
// path (POST update) and by the run audit so the two can never drift: a block
// count / power / placement / reachability that passes here is exactly what the
// server will accept, and `duration` is exactly what it will persist.
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

  let path: Point[] | undefined;
  try {
    // Throws when a piece is out of bounds or overlaps another (the player's or
    // the iteration's), so illegal placements never reach pathDuration. A bad
    // base board throws in the PathSolver constructor and lands here too,
    // before anything is cached. The shared cachedSolver reuses one base
    // precompute across every save/validation against the same iteration.
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
