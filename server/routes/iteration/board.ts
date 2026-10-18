// Fetch a buildable board WITHOUT starting a run (free play stages the board
// client-side). Access is util/boardAccess.ts's call: days before the player's
// local today are open, as is today once their three ranked attempts are spent;
// their own today before that, and anything later, is locked.

import { z } from "zod";
import { cachedSolver, pathDuration } from "../../../common/pathing.ts";
import type { Point } from "../../../common/types.ts";
import { errText, log } from "../../util/logging.ts";
import { getFlags } from "../../db/flags.ts";
import { getIteration, getIterationOtherBest } from "../../db/iteration.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
import { getOwnBest } from "../../db/user.ts";
import { checkBoardAccess } from "../../util/boardAccess.ts";
import { iterationAttempts } from "../../util/attempts.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { method } from "../apiHelpers.ts";

const getBoardBody = z.object({
  timeZone: z.string(),
  iteration: z.number().min(1).optional(),
});

export const getBoard = method(getBoardBody, true)(
  async ({ userId, timeZone, iteration: inputIteration }, req) => {
    const iteration = inputIteration ?? await (() => {
      const { year, month, day } = dailyParts(timeZone);
      return ensureDailyIterationId(year, month, day);
    })();

    // Locked answers { incomplete } (200), never an error: many paths
    // legitimately land on an unfinished today (regrade refetch, notification
    // tap, boot's linked-day slice), and the client relays EVERY error response
    // to reportClientError before the caller can swallow it. The answer is the
    // same for today and a future day and reveals no layout.
    if (await checkBoardAccess(userId, iteration, timeZone) === "locked") {
      return { incomplete: true as const };
    }

    const [data, ownBest, otherBest, attempts, flags] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
      // The splits tape's manual checkpoints. They ride this response because
      // every staging path (boot, dayView, board loaders) already makes the
      // call.
      getFlags(userId, iteration),
    ]);

    let path: Point[] | undefined;
    try {
      // The shared per-iteration solver caches this after the first stage.
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
      best: Math.max(otherBest ?? 0, ownBest ?? 0, data.min),
      attempts,
      flags,
      remainingTime: 60,
    };
  },
);
