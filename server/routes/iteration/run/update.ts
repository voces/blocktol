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

// Whether the save commits (daily attempt) or stays void until execution (free
// play) is derived server-side in updateCurrentRun from the run itself — the
// client no longer sends a freePlay flag (old cached clients still may; zod
// strips unknown keys).
const updateRunBody = z.object({
  iteration: z.number(),
  blocks: z.array(
    z.object({ x: z.number(), y: z.number(), thunder: z.boolean().optional() }),
  ),
});

const getIterationOtherBest = trailer(getIterationOtherBestRaw);

const isUpdate = is.object({ changedRows: is.number });

export const updateRun = method(updateRunBody, true)(
  async ({ iteration: iterationId, blocks, userId }, req) => {
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
      );
      // The batch is [SET, SELECT @ranked, save UPDATE, demote, promote] — the
      // save's result is the third entry.
      const saved = Array.isArray(r) ? r[2] : r;
      if (isUpdate(saved) && saved.changedRows === 0) {
        log.error(req, "Unexpected no rows changed");
      }
    } catch (err) {
      log.error(req, err);
      return { error: "failed to save run", status: 500 };
    }

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
