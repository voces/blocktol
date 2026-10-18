import { offsets } from "../../common/constants.ts";
import { newGrid, pathDuration, PathSolver } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import {
  createIteration,
  getDailyIterationId,
  getEarliestIterationDay,
} from "../db/iteration.ts";
import { backfillWindow, utcDay } from "./backfillWindow.ts";
import { log } from "./logging.ts";
import { UserError } from "./UserError.ts";

export const newIteration = async (date: Date) => {
  log.info("new iteration", { date: date.toDateString() });

  // Interior cells are 1..18 (0 and 19 are the border ring). The checkpoint is a
  // single cell at coord + 0.5, so 0.5..17.5 spans the interior and can sit
  // flush against any edge.
  const checkpoint = {
    x: 0.5 + Math.floor(Math.random() * 18),
    y: 0.5 + Math.floor(Math.random() * 18),
  };

  // The grid only tracks overlap; the solver owns reachability. One solver on
  // the empty board validates each placement as the same maze plus one piece,
  // the edit-stream shape its memo and one-added shortcut are built for.
  // Whether a path exists doesn't depend on thunder flags, so probes go in
  // unflagged; the timing solve below is a separate cold construction.
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

  // The stored `min` must equal what validateRun recomputes for the empty
  // placement (audits compare them), so time the final board on a COLD solver
  // with thunder flags, not the probe solver's reuse-derived path, whose
  // equal-length geometry could time differently near a thunder.
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

// Resolve a day's daily iteration id, generating it on demand when missing.
//
// The `ensure-iterations` cron (util/gen.ts) is the bulk generator, but Deno
// Deploy PREVIEW deployments (what dev is served by) don't run `Deno.cron`, so
// a dev env routinely asks for a daily nothing produced.
//
// Racing processes are safe by DB structure: `iteration.created` is UNIQUE
// (migration v14), so only one INSERT lands; the loser's is rejected and it
// re-reads the winner's row. No lock: the database IS the mutex.
//
// Bounded by backfillWindow: no later than tomorrow UTC (a far-future deep link
// can't leak a puzzle) and no earlier than the first existing day (a script
// walking back to year 1000 can't make us generate thousands of boards). The
// cron calls newIteration directly, so neither bound applies to it.
export const ensureDailyIterationId = async (
  year: number,
  month: number,
  day: number,
): Promise<number> => {
  const existing = await getDailyIterationId(year, month, day);
  if (existing !== undefined) return existing;

  // Every refusal is the same client-visible 400. Checked only after the lookup
  // misses, so a stale floor can never refuse a day that exists.
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const target = utcDay(year, month, day);
  if (
    target === null ||
    backfillWindow(target, await earliestDay(), todayUtc) !== "ok"
  ) {
    throw new UserError("no daily available for that date yet");
  }

  try {
    // A local-midnight Date for year/month/day, as createIteration and
    // getDailyIterationId expect (the server runs UTC, so local == UTC).
    await newIteration(new Date(year, month - 1, day));
  } catch (err) {
    // A concurrent isolate may have won: ours was rejected by UNIQUE(created).
    // If the row exists the race was harmless; otherwise the failure is real.
    const raced = await getDailyIterationId(year, month, day);
    if (raced !== undefined) return raced;
    throw err;
  }

  const id = await getDailyIterationId(year, month, day);
  if (id === undefined) {
    // Unreachable in practice; returning undefined into getIteration would 500.
    throw new UserError("no daily available for that date yet");
  }
  return id;
};

// The floor (MIN(created)), cached in-process. Only a backfill below it could
// move it earlier, which it forbids, so it is stale only on a fresh DB the cron
// is still seeding (31 days back). The hourly TTL bounds that and keeps a
// refused-date loop to one indexed MIN per isolate per hour. An empty table
// isn't cached: the next generation gives it a floor.
const FLOOR_TTL = 1_000 * 60 * 60;
let floorCache: { day: number; read: number } | undefined;
const earliestDay = async () => {
  if (floorCache && Date.now() - floorCache.read < FLOOR_TTL) {
    return floorCache.day;
  }
  const day = await getEarliestIterationDay();
  floorCache = day == null ? undefined : { day, read: Date.now() };
  return day;
};
