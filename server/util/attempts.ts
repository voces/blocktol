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
    // Position in the field's range, (time - min) / (best - min) — the stat the
    // runs panel and today-result show, and the band they colour by.
    percent: fieldBest === min
      ? 1
      : Math.max(0, Math.min(1, (run.time - min) / (fieldBest - min))),
    supreme: beatsField && i === bestIdx,
    // The first three runs are the day's ranked attempts; the rest are free play.
    ranked: i < 3,
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
