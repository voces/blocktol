// GET a buildable board WITHOUT starting a run (free play). Free play stages
// the board and only opens a run on the first placement. Any date is
// free-playable at any time — the ONLY gate is today's OWN daily, which can't
// be previewed or practiced before its three ranked attempts are spent. So a
// past day (including one that just rolled over) is always replayable, even
// while today's daily is still outstanding.

import { z } from "zod";
import { cachedSolver, pathDuration } from "../../../common/pathing.ts";
import type { Point } from "../../../common/types.ts";
import { errText, log } from "../../util/logging.ts";
import {
  getIteration,
  getIterationOtherBest,
  requireDailyIterationId,
} from "../../db/iteration.ts";
import { dailyAttempts, getOwnBest } from "../../db/user.ts";
import { iterationAttempts } from "../../util/attempts.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { method } from "../apiHelpers.ts";

const getBoardBody = z.object({
  timeZone: z.string(),
  iteration: z.number().min(1).optional(),
  // Boot primes today's board so "keep playing" opens instantly — but at prime
  // time the daily may not be done, which would 403. `soft` turns that lock
  // into a plain { incomplete } (200) so priming never fires a spurious
  // client-error report. Absent (every explicit caller), the 403 still stands.
  soft: z.boolean().optional(),
});

export const getBoard = method(getBoardBody, true)(
  async ({ userId, timeZone, iteration: inputIteration, soft }, req) => {
    const { year, month, day } = dailyParts(timeZone);
    const todayId = await requireDailyIterationId(year, month, day);
    const iteration = inputIteration ?? todayId;

    // The gate applies ONLY to today's own daily: it can't be free-played before
    // its three ranked attempts are spent (no previewing/practising the puzzle
    // you're about to rank). Every other date is ungated — replayable anytime,
    // even with today's daily still outstanding.
    if (iteration === todayId) {
      const todayAttempts = await dailyAttempts(userId, year, month, day);
      if (todayAttempts.length < 3) {
        if (soft) return { incomplete: true as const };
        return { error: "daily not complete", status: 403 };
      }
    }

    const [data, ownBest, otherBest, attempts] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
    ]);

    let path: Point[] | undefined;
    try {
      // The base board's path, from the shared per-iteration solver — after
      // the first stage of a board this is a cached copy, not a search.
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
      remainingTime: 60,
    };
  },
);
