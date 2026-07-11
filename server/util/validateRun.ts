import { pathDuration, PathSolver, type Slow } from "../../common/pathing.ts";
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

// PathSolver precomputes an iteration's base-board structure once and reuses
// it across every placement validated against that iteration — which is most
// of the server's pathing work, since a build session saves the full maze on
// every edit. Solvers are content-addressed (checkpoint + sorted base blocks)
// rather than keyed by iteration id so callers that only hold an
// IterationShape — this module's whole interface — share them too. The cap
// comfortably covers the handful of live iterations (one per day, and players
// mostly replay recent days); eviction is LRU via Map insertion order.
const solverCache = new Map<string, PathSolver>();
const MAX_SOLVERS = 32;

const solverFor = (iteration: IterationShape) => {
  const key = `${iteration.checkpoint.x},${iteration.checkpoint.y}|` +
    iteration.blocks.map((b) => `${b.x},${b.y}`).sort().join(";");
  const cached = solverCache.get(key);
  if (cached) {
    // Re-insert so hot iterations (today's daily) stay ahead of eviction.
    solverCache.delete(key);
    solverCache.set(key, cached);
    return cached;
  }
  const solver = new PathSolver(iteration.blocks, iteration.checkpoint);
  solverCache.set(key, solver);
  if (solverCache.size > MAX_SOLVERS) {
    solverCache.delete(solverCache.keys().next().value!);
  }
  return solver;
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
    // before anything is cached.
    path = solverFor(iteration).solve(playerBlocks);
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
