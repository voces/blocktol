// POST /iteration/:iteration/run
//     - must pass `timezone`
//     - if daily not complete
//         - :iteration MUST be the daily
//         - if last is in progress, 400s
//     - if daily complete, can always start a new
//     - returns a run id

import { z } from "zod";
import {
  getDailyIterationId,
  getIteration,
  getIterationOtherBest,
} from "../../../db/iteration.ts";
import { dailyParts } from "../../../util/dailyParts.ts";
import { method } from "../../apiHelpers.ts";
import { startRun as dbStartRun } from "../../../db/run.ts";
import { getOwnBest } from "../../../db/user.ts";
import { findPathFromData, pathDuration } from "../../../../common/pathing.ts";

const startRunBody = z.object({
  iteration: z.union([z.literal("daily"), z.number().min(1)]),
  timeZone: z.string(),
});

export const startRun = method(startRunBody, true)(
  async ({ userId, iteration: inputIteration, timeZone }) => {
    const { year, month, day } = dailyParts(timeZone);

    let iteration: number;
    if (inputIteration === "daily") {
      iteration = await getDailyIterationId(year, month, day);
    } else iteration = inputIteration;

    const [data, ownBest, otherBest] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
    ]);

    // Must finish within the request: the new Deploy tears down the isolate
    // after the response, so a still-pending write can be killed mid-flight.
    try {
      await dbStartRun(iteration, userId, data.min, year, month, day);
    } catch (err) {
      console.error(err);
      return { error: "failed to start run", status: 500 };
    }

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
      remainingTime: 60,
    };
  },
);
