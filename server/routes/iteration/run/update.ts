import { z } from "zod";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { updateCurrentRun } from "../../../db/run.ts";
import { onPbBuild } from "../../../util/pbBoard.ts";
import { errText, log } from "../../../util/logging.ts";
import { trailer } from "../../../util/memoize.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { method } from "../../apiHelpers.ts";

// Whether the save commits (daily attempt) or stays void until execution (free
// play) is derived server-side in updateCurrentRun from the run itself — the
// client no longer sends a freePlay flag (old cached clients still may; zod
// strips unknown keys).
const updateRunBody = z.object({
  iteration: z.number(),
  // The interior of the 20×20 board (its 18×18 non-border cells) is 324 cells, so
  // no legal maze can carry more than that many pieces; cap well above it (400) so
  // an oversized array is rejected by zod before validateRun pays to walk it — the
  // budget check in validateRun is per-piece and runs only after the full parse.
  blocks: z.array(
    z.object({ x: z.number(), y: z.number(), thunder: z.boolean().optional() }),
  ).max(400),
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
      log.error(req, "invalid iteration", { error: errText(err) });
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
      log.error(req, "failed to save run", { error: errText(err) });
      return { error: "failed to save run", status: 500 };
    }

    // A ranked attempt's build enters the PB field just like free play. When it
    // reaches the field top, run the PB-board side effects: lost-top
    // notifications for anyone it passed, and the Discord "top PB" record post /
    // tie edit. Gated on the (already-computed) otherBest so it costs nothing on
    // the common save that isn't leading; onPbBuild re-validates and dedupes both
    // effects, so a stream of leading saves within one attempt notifies/posts
    // once. The gate includes an exact TIE (>=) and the no-other-player case
    // (otherBest == null, this is the day's first build) because both can newly
    // set or match the day's record even though decideLostTop stays silent on
    // them. Awaited — background work is unsafe on this Deploy — and it never
    // throws.
    //
    // Accepted edge case: because this fires per build save (not at
    // finalization), a build can momentarily reach the field top — firing the
    // card / posting the record — then be trimmed back below it before the 60s
    // window freezes the attempt, leaving a stale "lost #1" (and a record post
    // whose holder later slipped). It's rare (you must lead mid-build, then
    // worsen the maze in the same window) and low-harm: the upsert/dedupe keeps
    // it to one card, which deep-links to live standings, so it reads as stale
    // rather than wrong. Deferring until the attempt finalizes would be the clean
    // fix, but this Deploy has no cheap cancelable one-off scheduler (a
    // `setTimeout` past the response dies with the isolate; `Deno.cron` is
    // hourly, not per-run), so real-time with rare staleness is the deliberate
    // trade. Free play doesn't have this — its `commitRun` hook fires once at
    // execution, when the build is already locked.
    if (otherBest == null || duration >= otherBest) {
      await onPbBuild(iterationId, userId);
    }

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
