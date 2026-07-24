// POST /iteration/:iteration/run
//     - must pass `timezone`
//     - if daily not complete
//         - :iteration MUST be the daily
//         - if last is in progress, 400s
//     - if daily complete, can always start a new
//     - returns a run id

import { z } from "zod";
import { errText, log } from "../../../util/logging.ts";
import { getIteration, getIterationOtherBest } from "../../../db/iteration.ts";
import { ensureDailyIterationId } from "../../../util/newIteration.ts";
import { dailyParts } from "../../../util/dailyParts.ts";
import { method } from "../../apiHelpers.ts";
import { startRun as dbStartRun, updateCurrentRun } from "../../../db/run.ts";
import { getOwnBest } from "../../../db/user.ts";
import { cachedSolver, pathDuration } from "../../../../common/pathing.ts";
import type { Point } from "../../../../common/types.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { iterationAttempts } from "../../../util/attempts.ts";

const startRunBody = z.object({
  iteration: z.union([z.literal("daily"), z.number().min(1)]),
  timeZone: z.string(),
  // The move that started the run (free play starts on the first placement, so
  // its opening block rides along with the start to save a round-trip). Only a
  // plain brick — the first action can't be a thunder/move/delete.
  block: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const startRun = method(startRunBody, true)(
  async ({ userId, iteration: inputIteration, timeZone, block }, req) => {
    const { year, month, day } = dailyParts(timeZone);

    let iteration: number;
    if (inputIteration === "daily") {
      iteration = await ensureDailyIterationId(year, month, day);
    } else iteration = inputIteration;

    // Fetched before dbStartRun so the run about to be created isn't counted —
    // these are the attempts already completed, for the client's attempts panel.
    const [data, ownBest, otherBest, attempts] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
    ]);

    // Validated up front so the opening block can be persisted below. A run
    // always starts void now: a free-play run (this is the only startRun that
    // carries a block) stays void until it executes (commitRun).
    const validation = block ? validateRun(data, [block]) : null;

    // Must finish within the request: the new Deploy tears down the isolate
    // after the response, so a still-pending write can be killed mid-flight.
    try {
      await dbStartRun(iteration, userId, data.min, year, month, day);
    } catch (err) {
      log.error(req, "failed to start run", { error: errText(err) });
      return { error: "failed to start run", status: 500 };
    }

    const best = Math.max(otherBest ?? 0, ownBest ?? 0, data.min);

    // The run opened with a placement (free play): persist it now so the first
    // brick doesn't need a second request, and return the board already holding
    // it. updateCurrentRun derives that this run isn't a ranked attempt, so it
    // stays void until it executes.
    if (block && validation?.ok) {
      const player = { ...block, player: true };
      try {
        await updateCurrentRun(
          userId,
          validation.duration,
          [player],
          iteration,
        );
      } catch (err) {
        // The run is started regardless; the client re-sends the maze on its
        // next placement, so a lost opening block self-heals.
        log.error(req, "failed to persist opening block", {
          error: errText(err),
        });
      }
      return {
        ...data,
        blocks: [...data.blocks, player],
        bricks: data.bricks - 1,
        path: validation.path,
        duration: validation.duration,
        slows: validation.slows,
        ownBest,
        best,
        attempts,
        remainingTime: 60,
      };
    }

    let path: Point[] | undefined;
    try {
      // The base board's path, from the shared per-iteration solver — after
      // the first start on a board this is a cached copy, not a search.
      path = cachedSolver(data.blocks, data.checkpoint).solve([]);
    } catch (err) {
      log.error(req, "invalid base path", { error: errText(err) });
      return { error: "invalid path", status: 400 };
    }

    if (!path) return { error: "invalid path", status: 400 };

    const [duration, slows] = pathDuration(
      path,
      data.blocks.filter((b) => b.thunder),
    );

    return {
      ...data,
      path,
      duration,
      slows,
      ownBest,
      best,
      attempts,
      remainingTime: 60,
    };
  },
);
