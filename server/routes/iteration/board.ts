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
import { getIteration, getIterationOtherBest } from "../../db/iteration.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
import { dailyAttempts, getOwnBest } from "../../db/user.ts";
import { iterationAttempts } from "../../util/attempts.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { method } from "../apiHelpers.ts";

const getBoardBody = z.object({
  timeZone: z.string(),
  iteration: z.number().min(1).optional(),
});

export const getBoard = method(getBoardBody, true)(
  async ({ userId, timeZone, iteration: inputIteration }, req) => {
    const { year, month, day } = dailyParts(timeZone);
    const todayId = await ensureDailyIterationId(year, month, day);
    const iteration = inputIteration ?? todayId;

    // The gate applies ONLY to today's own daily: it can't be free-played before
    // its three ranked attempts are spent (no previewing/practising the puzzle
    // you're about to rank). Every other date is ungated — replayable anytime,
    // even with today's daily still outstanding.
    //
    // The locked answer is a plain { incomplete } (200), never an error. It used
    // to 403 unless the caller opted into `soft`, and only boot ever did — so
    // every other path that can legitimately land on an unfinished today
    // (the regrade refetch, a notification tap, boot's own linked-day slice for a
    // today permalink, a calendar pick while parked on a past day) turned a
    // routine "not yet" into a 403. The client relays EVERY error response to
    // reportClientError from inside the api proxy, before the caller can swallow
    // it, so each one logged an error server-side even where the call site was
    // written to ignore it. Nothing ever wanted the error: "not yet" is a state,
    // not a fault, and it leaks nothing either way.
    if (iteration === todayId) {
      const todayAttempts = await dailyAttempts(userId, year, month, day);
      if (todayAttempts.length < 3) return { incomplete: true as const };
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
