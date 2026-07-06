import { z } from "zod";
import { findPathFromData, pathDuration } from "../../../common/pathing.ts";
import {
  getDailyIterationId,
  getIteration,
  getIterationOtherBest,
  getIterationTimeCounts,
} from "../../db/iteration.ts";
import { getLatestRun } from "../../db/run.ts";
import {
  allRunsByIteration,
  attemptRunsByIteration,
  createOrUpdateUser,
} from "../../db/user.ts";
import { mapAttempts } from "../../util/attempts.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { fieldQuantiles } from "../../util/math.ts";
import { method } from "../apiHelpers.ts";

const getDailySummaryBody = z.union([
  z.object({ timeZone: z.string() }),
  z.object({ iteration: z.number().min(1) }),
]);

export const getDailySummary = method(getDailySummaryBody, true)(
  async ({ userId, ...rest }) => {
    const iterationId = "timeZone" in rest
      ? (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return getDailyIterationId(year, month, day);
      })()
      : Promise.resolve(rest.iteration);

    const [
      timeCounts,
      otherBest,
      iteration,
      latestRun,
      allRuns,
      rankedRuns,
      user,
    ] = await Promise.all([
      iterationId.then((id) => getIterationTimeCounts(id, userId)),
      iterationId.then((id) => getIterationOtherBest(id, userId)),
      iterationId.then((id) => getIteration(id)),
      iterationId.then((id) => getLatestRun(userId, id, true)),
      iterationId.then((id) => allRunsByIteration(userId, id)),
      // The ranked three include void (abandoned) runs — abandoning still
      // spends an attempt, so they must count even though the panel hides them.
      iterationId.then((id) => attemptRunsByIteration(userId, id)),
      createOrUpdateUser(userId),
    ]);

    const remainingTime = Math.floor(
      60 - (Date.now() - new Date(latestRun?.created ?? 0).getTime()) /
          1000,
    );
    const currentRun = latestRun && remainingTime > 0
      ? (() => {
        const blocks = [
          ...iteration.blocks,
          ...latestRun.maze.map((b) => ({ ...b, player: true })),
        ] as { x: number; y: number; player?: boolean; thunder?: boolean }[];

        let path: ReturnType<typeof findPathFromData>;
        try {
          path = findPathFromData(blocks, iteration.checkpoint);
        } catch (err) {
          console.error(err);
          return { error: "invalid path", status: 400 };
        }

        if (!path) return { error: "invalid path", status: 400 };

        const [duration, slows] = pathDuration(
          path,
          [
            ...iteration.blocks.filter((b) => b.thunder),
            ...latestRun.maze.filter((b) => b.thunder),
          ],
        );

        const ownBest = allRuns.length
          ? Math.max(...allRuns.map((r) => r.time))
          : null;

        return {
          ...iteration,
          blocks,
          bricks: iteration.bricks - latestRun.maze.length,
          power: iteration.power -
            latestRun.maze.filter((b) => b.thunder).length,
          remainingTime,
          ownBest,
          path,
          duration,
          slows,
          best: Math.max(otherBest ?? 0, ownBest ?? 0, iteration.min),
        };
      })()
      : null;

    if (currentRun && "error" in currentRun) {
      throw new Error("Unexpected invalid path on daily recovery");
    }

    return {
      rating: user?.rating ?? 1000,
      // `attempts` is the full non-void list (panel); `ranked` is the first three
      // (result modal + attempts-remaining), void included.
      attempts: mapAttempts(allRuns, timeCounts, otherBest, iteration.min),
      ranked: mapAttempts(rankedRuns, timeCounts, otherBest, iteration.min),
      stats: fieldQuantiles(timeCounts),
      currentRun,
    };
  },
);
