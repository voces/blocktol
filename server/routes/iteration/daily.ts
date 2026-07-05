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
  createOrUpdateUser,
  dailyAttempts,
  dailyAttemptsByIteration,
} from "../../db/user.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { fieldQuantiles, percentileFromTimeCounts } from "../../util/math.ts";
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

    const attemptsPromise = "timeZone" in rest
      ? (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return dailyAttempts(userId, year, month, day);
      })()
      : dailyAttemptsByIteration(userId, rest.iteration);

    const [timeCounts, otherBest, iteration, latestRun, attempts, user] =
      await Promise.all([
        iterationId.then((id) => getIterationTimeCounts(id, userId)),
        iterationId.then((id) => getIterationOtherBest(id, userId)),
        iterationId.then((id) => getIteration(id)),
        iterationId.then((id) => getLatestRun(userId, id, true)),
        attemptsPromise,
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

        const ownBest = attempts.length ? Math.max(...attempts) : null;

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

    // "Supreme" (the daily record) is a single standing, not something every
    // beating attempt earns — mark only your best run, and only when it actually
    // tops the field.
    const bestAttempt = attempts.length ? Math.max(...attempts) : null;
    const beatsField = bestAttempt !== null &&
      (!otherBest || bestAttempt > otherBest);

    return {
      rating: user?.rating ?? 1000,
      attempts: attempts.map((duration) => ({
        duration,
        percentile: percentileFromTimeCounts(timeCounts, duration),
        supreme: beatsField && duration === bestAttempt,
      })),
      stats: fieldQuantiles(timeCounts),
      currentRun,
    };
  },
);
