import { z } from "zod";
import { cachedSolver, pathDuration } from "../../../common/pathing.ts";
import type { Point } from "../../../common/types.ts";
import {
  getIteration,
  getIterationOtherBest,
  getIterationTimeCounts,
  requireDailyIterationId,
} from "../../db/iteration.ts";
import { getLatestRun, startRun as dbStartRun } from "../../db/run.ts";
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
        return requireDailyIterationId(year, month, day);
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

    let [latestRun, allRuns, rankedRuns] = await Promise.all([
      iterationId.then((id) => getLatestRun(userId, id, true)),
      iterationId.then((id) => allRunsByIteration(userId, id)),
      // The ranked three include void (abandoned) runs — abandoning still
      // spends an attempt, so they must count even though the panel hides them.
      iterationId.then((id) => attemptRunsByIteration(userId, id)),
    ]);

    const remaining = (created: string | undefined) =>
      Math.floor(60 - (Date.now() - new Date(created ?? 0).getTime()) / 1000);

    // Boot (the timeZone variant): auto-start the next daily attempt when
    // nothing is in progress and attempts remain, so the board is playable off
    // this one response. The client used to read the summary and then issue a
    // second startRun round trip; semantics are unchanged — opening the app
    // starts the attempt, and abandoning it still spends it. Old cached
    // clients guard their follow-up startRun on currentRun, so they won't
    // double-start; the new client keeps that startRun as a fallback should
    // this insert fail. Not done for the {iteration} variant, which reviews a
    // specific day rather than booting.
    if (
      "timeZone" in rest && rankedRuns.length < 3 &&
      !(latestRun && remaining(latestRun.created) > 0)
    ) {
      const { year, month, day } = dailyParts(rest.timeZone);
      try {
        await dbStartRun(
          await iterationId,
          userId,
          iteration.min,
          year,
          month,
          day,
        );
        [latestRun, allRuns, rankedRuns] = await Promise.all([
          iterationId.then((id) => getLatestRun(userId, id, true)),
          iterationId.then((id) => allRunsByIteration(userId, id)),
          iterationId.then((id) => attemptRunsByIteration(userId, id)),
        ]);
      } catch (err) {
        // The summary still serves without the auto-start; the client's
        // fallback startRun recovers the board.
        console.error(err);
      }
    }

    const remainingTime = remaining(latestRun?.created);
    const rawCurrentRun = latestRun && remainingTime > 0
      ? (() => {
        const blocks = [
          ...iteration.blocks,
          ...latestRun.maze.map((b) => ({ ...b, player: true })),
        ] as { x: number; y: number; player?: boolean; thunder?: boolean }[];

        let path: Point[] | undefined;
        try {
          // The in-progress maze against the shared per-iteration solver —
          // the same engine (and tie-breaking) that timed its saves.
          path = cachedSolver(iteration.blocks, iteration.checkpoint)
            .solve(latestRun.maze);
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

    // A corrupt persisted maze must not 500 the boot call for the rest of the
    // run's window — degrade to no resumable run (logged above); the player
    // gets a summary without a board rather than a broken app.
    const currentRun = rawCurrentRun && "error" in rawCurrentRun
      ? null
      : rawCurrentRun;

    // The in-progress run is the board, not a finished attempt: keep it out of
    // the panel list, where it would show as a phantom min-time row (visible
    // since the auto-start above — and previously on any mid-attempt refresh).
    // `ranked` still includes it: attempts-remaining counts it as underway.
    const panelRuns = currentRun && latestRun
      ? allRuns.filter(
        (r) => r.created !== new Date(latestRun.created).getTime(),
      )
      : allRuns;

    return {
      rating: user?.rating ?? 1000,
      // `attempts` is the full non-void list (panel); `ranked` is the first three
      // (result modal + attempts-remaining), void included.
      attempts: mapAttempts(panelRuns, timeCounts, otherBest, iteration.min),
      ranked: mapAttempts(rankedRuns, timeCounts, otherBest, iteration.min),
      stats: fieldQuantiles(timeCounts),
      currentRun,
    };
  },
);
