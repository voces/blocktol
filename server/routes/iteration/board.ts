// GET a buildable board WITHOUT starting a run (free play). Free play stages
// the board and only opens a run on the first placement. Which boards are
// stageable is util/boardAccess.ts's call: every day before the player's local
// today is open, as is one they have spent their three ranked attempts on; their
// own today (before that) and anything later is locked.

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

    // The gate (util/boardAccess.ts): a past day, or one whose ranked attempts
    // are spent, is open; the caller's own today or a later day is locked.
    //
    // The locked answer is a plain { incomplete } (200), never an error. Many
    // paths legitimately land on an unfinished today (the regrade refetch, a
    // notification tap, boot's own linked-day slice for a today permalink, a
    // calendar pick while parked on a past day), and the client relays EVERY
    // error response to reportClientError from inside the api proxy, before the
    // caller can swallow it — so a 403 would log a server-side error even where
    // the call site ignores it. "Not yet" is a state, not a fault, and it leaks
    // nothing either way — the same answer for today and for a future day,
    // layout-free.
    if (await checkBoardAccess(userId, iteration, timeZone) === "locked") {
      return { incomplete: true as const };
    }

    const [data, ownBest, otherBest, attempts, flags] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
      // The player's own flags on this board (the splits tape's manual
      // checkpoints). They ride the board response because that is the one call
      // every free-play staging path already makes — boot, dayView and the
      // board loaders all compose it — so the tape needs no fetch of its own.
      getFlags(userId, iteration),
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
      flags,
      remainingTime: 60,
    };
  },
);
