import { standing } from "../../common/standing.ts";
import { Point } from "../../common/types.ts";
import {
  getIteration,
  getIterationOtherBest,
  getIterationTimeCounts,
} from "../db/iteration.ts";
import { allRunsByIteration } from "../db/user.ts";
import { percentileFromTimeCounts } from "./math.ts";

type AttemptRun = {
  time: number;
  maze: (Point & { thunder?: boolean })[];
  created: number;
  // Whether this run was a ranked daily attempt (set by allRunsByIteration).
  // Absent for the ranked-three list (attemptRunsByIteration), which is ranked
  // by construction — falls back to position there.
  ranked?: boolean;
  // Whether the player pinned this run (set by allRunsByIteration). Absent for
  // the ranked-three list, which the panel never renders — defaults to false.
  pinned?: boolean;
};

// Shape each attempt run into the client's attempt row: field percentile, the
// standing-record flag, and the maze the player built (so a row can re-render
// it). "Supreme" is a single standing — only the best attempt, and only when it
// actually tops the rest of the field. Split from the fetch so getDailySummary
// can reuse its already-loaded timeCounts/otherBest.
export const mapAttempts = (
  runs: AttemptRun[],
  timeCounts: { time: number; count: number }[],
  otherBest: number | null,
  min: number,
) => {
  const bestRun = runs.length ? Math.max(...runs.map((r) => r.time)) : null;
  const beatsField = bestRun !== null && (!otherBest || bestRun > otherBest);
  // A single standing: only the first run at the best time is supreme, so tied
  // runs don't both light up gold.
  const bestIdx = bestRun === null
    ? -1
    : runs.findIndex((r) => r.time === bestRun);
  // Field best (anyone) — the ceiling for each run's position in [min, best].
  const fieldBest = Math.max(otherBest ?? 0, bestRun ?? 0, min);

  return runs.map((run, i) => ({
    duration: run.time,
    // Field percentile (how many you beat) for the result modal.
    percentile: percentileFromTimeCounts(timeCounts, run.time),
    // Position in the field's range — the stat the runs panel and
    // today-result show, and the band they colour by.
    percent: standing(run.time, min, fieldBest),
    supreme: beatsField && i === bestIdx,
    // A ranked daily attempt (created on the daily's day, among the first three)
    // vs free play. Positional fallback for the ranked-three list, which carries
    // no flag but is ranked by construction.
    ranked: run.ranked ?? i < 3,
    // The player's pin, floating this run to the top of their runs panel.
    pinned: run.pinned ?? false,
    maze: run.maze,
    created: run.created,
  }));
};

// The viewer's full attempts list on an iteration — fed to startRun / getBoard
// so their attempts panel matches getDailySummary's.
export const iterationAttempts = async (userId: string, iteration: number) => {
  const [runs, timeCounts, otherBest, data] = await Promise.all([
    allRunsByIteration(userId, iteration),
    getIterationTimeCounts(iteration, userId),
    getIterationOtherBest(iteration, userId),
    getIteration(iteration),
  ]);

  return mapAttempts(runs, timeCounts, otherBest, data.min);
};
