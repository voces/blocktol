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
  // Set by allRunsByIteration. Absent for attemptRunsByIteration (ranked by
  // construction), where position stands in.
  ranked?: boolean;
  // Set by allRunsByIteration. Absent for attemptRunsByIteration, whose rows
  // the panel never renders.
  pinned?: boolean;
};

// Shape each attempt run into the client's attempt row: field percentile,
// standing, the supreme flag, and the maze. "Supreme" is a single standing:
// only the best attempt, and only when it beats the rest of the field. Split
// from the fetch so getDailySummary can reuse its loaded timeCounts/otherBest.
export const mapAttempts = (
  runs: AttemptRun[],
  timeCounts: { time: number; count: number }[],
  otherBest: number | null,
  min: number,
) => {
  const bestRun = runs.length ? Math.max(...runs.map((r) => r.time)) : null;
  const beatsField = bestRun !== null && (!otherBest || bestRun > otherBest);
  // Only the first run at the best time is supreme, so ties don't both light.
  const bestIdx = bestRun === null
    ? -1
    : runs.findIndex((r) => r.time === bestRun);
  // The ceiling for each run's position in [min, best].
  const fieldBest = Math.max(otherBest ?? 0, bestRun ?? 0, min);

  return runs.map((run, i) => ({
    duration: run.time,
    // How much of the field this run beats.
    percentile: percentileFromTimeCounts(timeCounts, run.time),
    // Position in the field's range; the runs panel and today-result colour
    // by it.
    percent: standing(run.time, min, fieldBest),
    supreme: beatsField && i === bestIdx,
    ranked: run.ranked ?? i < 3,
    pinned: run.pinned ?? false,
    maze: run.maze,
    created: run.created,
  }));
};

// The viewer's full attempts list on an iteration, so startRun / getBoard match
// getDailySummary's attempts panel.
export const iterationAttempts = async (userId: string, iteration: number) => {
  const [runs, timeCounts, otherBest, data] = await Promise.all([
    allRunsByIteration(userId, iteration),
    getIterationTimeCounts(iteration, userId),
    getIterationOtherBest(iteration, userId),
    getIteration(iteration),
  ]);

  return mapAttempts(runs, timeCounts, otherBest, data.min);
};
