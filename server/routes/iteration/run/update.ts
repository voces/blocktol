import { z } from "zod";
import { is } from "../../../../common/typeguards.ts";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { updateCurrentRun } from "../../../db/run.ts";
import { log } from "../../../util/logging.ts";
import { trailer } from "../../../util/memoize.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { method } from "../../apiHelpers.ts";

const updateRunBody = z.object({
  iteration: z.number(),
  blocks: z.array(
    z.object({ x: z.number(), y: z.number(), thunder: z.boolean().optional() }),
  ),
  // Free-play builds don't commit (the run stays void until it executes); daily
  // attempts do. Defaults to a committing (daily) update when absent.
  freePlay: z.boolean().optional(),
});

const getIterationOtherBest = trailer(getIterationOtherBestRaw);

const isUpdate = is.object({ changedRows: is.number });

export const updateRun = method(updateRunBody, true)(
  async ({ iteration: iterationId, blocks, userId, freePlay }, req) => {
    let iteration: Awaited<ReturnType<typeof getIteration>>;
    let otherBest: number | null;
    try {
      [iteration, otherBest] = await Promise.all([
        getIteration(iterationId),
        getIterationOtherBest(iterationId, userId)(),
      ]);
    } catch (err) {
      console.error(err);
      return { error: "invalid iteration", status: 400 };
    }

    const validation = validateRun(iteration, blocks);
    if (!validation.ok) return { error: validation.reason, status: 400 };
    const { path, duration, slows } = validation;

    // Must finish within the request: the new Deploy tears down the isolate
    // after the response, so a still-pending write can be killed mid-flight.
    try {
      const r = await updateCurrentRun(
        userId,
        duration,
        blocks.map((b) => ({ ...b, player: true })),
        iterationId,
        !freePlay,
      );
      if (isUpdate(r) && r.changedRows === 0) {
        log.error(req, "Unexpected no rows changed");
      }
    } catch (err) {
      log.error(req, err);
      return { error: "failed to save run", status: 500 };
    }

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
