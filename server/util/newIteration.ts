import { offsets } from "../../common/constants.ts";
import { newGrid, pathDuration, PathSolver } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import { createIteration, getDailyIterationId } from "../db/iteration.ts";
import { log } from "./logging.ts";
import { UserError } from "./UserError.ts";

const ONE_DAY = 1_000 * 60 * 60 * 24;

export const newIteration = async (date: Date) => {
  log.info("new iteration", { date: date.toDateString() });

  // Interior cells are 1..18 (0 and 19 are the border ring). The checkpoint is a
  // single cell at coord + 0.5, so 0.5..17.5 spans the full interior and can sit
  // flush against any edge. (An earlier 1.5 start left cell 1 unused, so the
  // checkpoint could hug the bottom/right walls but never the top/left.)
  const checkpoint = {
    x: 0.5 + Math.floor(Math.random() * 18),
    y: 0.5 + Math.floor(Math.random() * 18),
  };

  // The grid is overlap bookkeeping only; the solver owns reachability. One
  // solver on the empty board validates every incremental placement — the
  // same maze plus one piece per probe, exactly the edit-stream shape its
  // memo and one-added shortcut are built for. Existence answers are exact
  // whatever the thunder flags, so probes go in unflagged; the final timing
  // solve below is a separate cold construction.
  const grid = newGrid();
  grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
  const solver = new PathSolver([], checkpoint);
  const placed: Point[] = [];
  const placeIfSolvable = (x: number, y: number) => {
    if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return false;
    if (!solver.solve([...placed, { x, y }])) return false;
    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    placed.push({ x, y });
    return true;
  };

  let r = Math.random();
  let n = r < 0.04 ? 2 : r < 0.2 ? 1 : 0;
  const thunders: Point[] = [];
  while (n--) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);
    if (placeIfSolvable(x, y)) thunders.push({ x, y });
  }

  n = Math.floor((1 - Math.random()) ** 0.5 * 49);
  const blocks: Point[] = [];
  while (n-- > 0 || blocks.length === 0) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);
    if (placeIfSolvable(x, y)) blocks.push({ x, y });
  }

  r = Math.random();
  const power = r < 0.09 ? 2 : r < 0.3 ? 1 : 0;
  const bricks = power +
    Math.floor((1 - Math.random() ** 0.7) ** 0.9 * 20) + 3;

  // The stored `min` must be exactly what validateRun recomputes for the empty
  // placement later (audits compare them), so time the final board on a COLD
  // solver with the thunder flags in place — never a probe solver's
  // reuse-derived path, whose equal-length geometry could time differently
  // near a thunder.
  const path = new PathSolver(
    [...blocks, ...thunders.map((t) => ({ ...t, thunder: true }))],
    checkpoint,
  ).solve([]);
  const [duration] = pathDuration(path, thunders);

  await createIteration(
    date,
    bricks,
    power,
    checkpoint,
    blocks,
    thunders,
    duration,
  );
};

// Resolve a day's daily iteration id, generating it on demand when it's missing.
//
// The `ensure-iterations` cron (util/gen.ts) is the bulk generator, but it only
// runs on a deployment that executes `Deno.cron` — and Deno Deploy PREVIEW
// deployments (what dev is usually served by) don't. So a dev/gappy environment
// routinely asks for a daily nothing ever produced, which is where the old
// "no daily available for that date yet" came from.
//
// This reinstates the per-request backfill that was removed for being racy —
// now made safe by DB structure, not app coordination: `iteration.created` is
// UNIQUE (migration v14), so two isolates racing to create the same day can't
// duplicate it. Both may run the (idempotent) generation, but only one INSERT
// lands; the loser's is rejected by the unique key, and it re-reads the winner's
// row. That's why this needs no lock — the database IS the mutex.
//
// Bounded to no later than tomorrow UTC — the cron's own look-ahead — so a deep
// link to a far-future date can't force generation and leak a puzzle that isn't
// playable yet. A missing PAST date is a real gap and is backfilled.
export const ensureDailyIterationId = async (
  year: number,
  month: number,
  day: number,
): Promise<number> => {
  const existing = await getDailyIterationId(year, month, day);
  if (existing !== undefined) return existing;

  // No timezone is ever on a local day later than tomorrow UTC, so a request
  // beyond that is a future deep link, not a missing daily — refuse it (the same
  // client-visible 400 the old requireDailyIterationId threw).
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (Date.UTC(year, month - 1, day) > todayUtc + ONE_DAY) {
    throw new UserError("no daily available for that date yet");
  }

  try {
    // Local-midnight Date whose local Y/M/D are exactly year/month/day, matching
    // how createIteration derives the stored day and how getDailyIterationId
    // looks it up (the server runs UTC, so local == UTC there).
    await newIteration(new Date(year, month - 1, day));
  } catch (err) {
    // A concurrent isolate may have won the race: its INSERT landed and ours was
    // rejected by UNIQUE(created). If the row now exists the race was harmless;
    // otherwise the failure is real and propagates.
    const raced = await getDailyIterationId(year, month, day);
    if (raced !== undefined) return raced;
    throw err;
  }

  const id = await getDailyIterationId(year, month, day);
  if (id === undefined) {
    // Should not happen — we just created it — but never return undefined into
    // getIteration, which would 500. Surface the same clean 400 instead.
    throw new UserError("no daily available for that date yet");
  }
  return id;
};
