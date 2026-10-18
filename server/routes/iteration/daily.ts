import { z } from "zod";
import { cachedSolver, pathDuration } from "../../../common/pathing.ts";
import type { Point } from "../../../common/types.ts";
import { errText, log } from "../../util/logging.ts";
import {
  getIteration,
  getIterationOtherBest,
  getIterationTimeCounts,
} from "../../db/iteration.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
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
  async ({ userId, ...rest }, req) => {
    const iterationId = "timeZone" in rest
      ? (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return ensureDailyIterationId(year, month, day);
      })()
      : Promise.resolve(rest.iteration);

    const [
      timeCounts,
      otherBest,
      iteration,
      user,
    ] = await Promise.all([
      iterationId.then((id) => getIterationTimeCounts(id, userId)),
      iterationId.then((id) => getIterationOtherBest(id, userId)),
      iterationId.then((id) => getIteration(id)),
      createOrUpdateUser(userId),
    ]);

    const [latestRun, allRuns, rankedRuns] = await Promise.all([
      iterationId.then((id) => getLatestRun(userId, id, true)),
      iterationId.then((id) => allRunsByIteration(userId, id)),
      // Includes void runs: abandoning still spends an attempt.
      iterationId.then((id) => attemptRunsByIteration(userId, id)),
    ]);

    const remaining = (created: string | undefined) =>
      Math.floor(60 - (Date.now() - new Date(created ?? 0).getTime()) / 1000);

    // The summary never starts an attempt, so a background boot or refresh
    // can't spend one; only the client's "Start attempt" (`startRun`) does.
    // With attempts left (`ranked` under three) and nothing underway, the
    // client shows that overlay. An already-open run is resumed below.

    const remainingTime = remaining(latestRun?.created);
    const rawCurrentRun = latestRun && remainingTime > 0
      ? (() => {
        const blocks = [
          ...iteration.blocks,
          ...latestRun.maze.map((b) => ({ ...b, player: true })),
        ] as { x: number; y: number; player?: boolean; thunder?: boolean }[];

        let path: Point[] | undefined;
        try {
          // The same solver (and tie-breaking) that timed the run's saves.
          path = cachedSolver(iteration.blocks, iteration.checkpoint)
            .solve(latestRun.maze);
        } catch (err) {
          log.error(req, "invalid path", { error: errText(err) });
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

    // A corrupt persisted maze degrades to no resumable run (logged above)
    // rather than 500ing boot for the rest of the run's window.
    const currentRun = rawCurrentRun && "error" in rawCurrentRun
      ? null
      : rawCurrentRun;

    // Keep the in-progress run out of the panel list, where it would show as a
    // phantom min-time row. `ranked` still includes it so it counts as
    // underway.
    const panelRuns = currentRun && latestRun
      ? allRuns.filter(
        (r) => r.created !== new Date(latestRun.created).getTime(),
      )
      : allRuns;

    return {
      rating: user?.rating ?? 1000,
      // `attempts`: all non-void runs (panel). `ranked`: the first three, void
      // included (result modal, attempts remaining).
      attempts: mapAttempts(panelRuns, timeCounts, otherBest, iteration.min),
      ranked: mapAttempts(rankedRuns, timeCounts, otherBest, iteration.min),
      stats: fieldQuantiles(timeCounts),
      currentRun,
    };
  },
);
