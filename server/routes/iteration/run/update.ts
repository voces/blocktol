import { z } from "zod";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { updateCurrentRun } from "../../../db/run.ts";
import { checkLostTop } from "../../../util/lostTop.ts";
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

export const updateRun = method(updateRunBody, true)(
  async ({ iteration: iterationId, blocks, userId }, req) => {
    let iteration: Awaited<ReturnType<typeof getIteration>>;
    // The best build among other players (void excluded) — the mark this build
    // must beat to lead the field, used for both the supreme flag and the
    // lost-top gate below.
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
      const { saved } = await updateCurrentRun(
        userId,
        duration,
        blocks.map((b) => ({ ...b, player: true })),
        iterationId,
      );
      // The run's 60s window closed before this save (or there's no current
      // run): the edit was NOT persisted. Not an error — success-shaped so the
      // client doesn't report it; it reverts the optimistic edit to the last
      // accepted maze and starts the run (which is what the server is doing).
      if (!saved) return { expired: true as const };
    } catch (err) {
      log.error(req, err);
      return { error: "failed to save run", status: 500 };
    }

    // A ranked attempt's build enters the PB field just like free play. When it
    // passes the field top, notify whoever it displaced. Gated on the
    // (already-computed) otherBest so it costs nothing on the common save that
    // isn't leading; checkLostTop re-validates and dedupes the push, so a stream
    // of leading saves within one attempt notifies the victim only once. Awaited
    // — background work is unsafe on this Deploy — and it never throws.
    if (otherBest != null && duration > otherBest) {
      await checkLostTop(iterationId, userId);
    }

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
