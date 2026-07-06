// GET a buildable board WITHOUT starting a run (free play). The daily's three
// ranked attempts always auto-start on request; free play instead stages the
// board and only opens a run on the first placement. Gated so the board can't
// be previewed before the ranked attempts are spent: you must have used all
// three attempts on today's daily (the latest day) to unlock free play.

import { z } from "zod";
import { findPathFromData, pathDuration } from "../../../common/pathing.ts";
import {
  getDailyIterationId,
  getIteration,
  getIterationOtherBest,
} from "../../db/iteration.ts";
import { dailyAttempts, getOwnBest } from "../../db/user.ts";
import { iterationAttempts } from "../../util/attempts.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { method } from "../apiHelpers.ts";

const getBoardBody = z.object({
  timeZone: z.string(),
  iteration: z.number().min(1).optional(),
});

export const getBoard = method(getBoardBody, true)(
  async ({ userId, timeZone, iteration: inputIteration }) => {
    const { year, month, day } = dailyParts(timeZone);

    // Free play unlocks once today's three attempts are spent; with today being
    // the latest day, that also unlocks every past day for replay.
    const todayAttempts = await dailyAttempts(userId, year, month, day);
    if (todayAttempts.length < 3) {
      return { error: "daily not complete", status: 403 };
    }

    const iteration = inputIteration ??
      await getDailyIterationId(year, month, day);

    const [data, ownBest, otherBest, attempts] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
    ]);

    let path: ReturnType<typeof findPathFromData>;
    try {
      path = findPathFromData(data.blocks, data.checkpoint);
    } catch (err) {
      console.error(err);
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
