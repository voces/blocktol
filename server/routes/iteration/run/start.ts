// startRun: opens a run and hands back the board to build on.
//   - `iteration: "daily"` opens a ranked attempt for the caller's local day
//     (`ranked` is stamped here, from `timeZone`, and nowhere else).
//   - A numeric `iteration` is free play, behind the board gate
//     (util/boardAccess.ts); its optional opening `block` rides along.
//   - The row is inserted void; a ranked run clears void on its first build
//     (updateRun), a free-play run when it executes (commitRun).

import { z } from "zod";
import { errText, log } from "../../../util/logging.ts";
import { getIteration, getIterationOtherBest } from "../../../db/iteration.ts";
import { ensureDailyIterationId } from "../../../util/newIteration.ts";
import { dailyParts } from "../../../util/dailyParts.ts";
import { method } from "../../apiHelpers.ts";
import { pieceCoords } from "./piece.ts";
import { startRun as dbStartRun, updateCurrentRun } from "../../../db/run.ts";
import { getOwnBest } from "../../../db/user.ts";
import { cachedSolver, pathDuration } from "../../../../common/pathing.ts";
import type { Point } from "../../../../common/types.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { iterationAttempts } from "../../../util/attempts.ts";
import { checkBoardAccess } from "../../../util/boardAccess.ts";

const startRunBody = z.object({
  iteration: z.union([z.literal("daily"), z.number().min(1)]),
  timeZone: z.string(),
  // Free play starts on its first placement; that block rides along to save a
  // round trip. A plain brick only: the first action can't be a thunder, move
  // or delete.
  block: pieceCoords.optional(),
});

export const startRun = method(startRunBody, true)(
  async ({ userId, iteration: inputIteration, timeZone, block }, req) => {
    const { year, month, day } = dailyParts(timeZone);

    let iteration: number;
    if (inputIteration === "daily") {
      iteration = await ensureDailyIterationId(year, month, day);
    } else {
      iteration = inputIteration;
      // Free play hands back the board, so it answers to getBoard's gate
      // (util/boardAccess.ts). The normal client only starts a board it was
      // shown, so a locked answer is a probe: a 403, not getBoard's quiet
      // { incomplete }, and no layout.
      if (await checkBoardAccess(userId, iteration, timeZone) === "locked") {
        return { error: "board locked", status: 403 };
      }
    }

    // Fetched before dbStartRun so the new run isn't counted among the
    // completed attempts.
    const [data, ownBest, otherBest, attempts] = await Promise.all([
      getIteration(iteration),
      getOwnBest(userId, iteration),
      getIterationOtherBest(iteration, userId),
      iterationAttempts(userId, iteration),
    ]);

    // Validated up front so the opening block can be persisted below.
    const validation = block ? validateRun(data, [block]) : null;

    // Awaited: a Deno Deploy preview kills a write still pending after the
    // response.
    try {
      await dbStartRun(iteration, userId, data.min, year, month, day);
    } catch (err) {
      log.error(req, "failed to start run", { error: errText(err) });
      return { error: "failed to start run", status: 500 };
    }

    const best = Math.max(otherBest ?? 0, ownBest ?? 0, data.min);

    // Free play opened with a placement: persist it now and return the board
    // holding it. updateCurrentRun sees the run isn't ranked, so it stays void
    // until it executes.
    if (block && validation?.ok) {
      const player = { ...block, player: true };
      try {
        await updateCurrentRun(
          userId,
          validation.duration,
          [player],
          iteration,
        );
      } catch (err) {
        // The client re-sends the maze on its next placement, healing this.
        log.error(req, "failed to persist opening block", {
          error: errText(err),
        });
      }
      return {
        ...data,
        blocks: [...data.blocks, player],
        bricks: data.bricks - 1,
        path: validation.path,
        duration: validation.duration,
        slows: validation.slows,
        ownBest,
        best,
        attempts,
        remainingTime: 60,
      };
    }

    let path: Point[] | undefined;
    try {
      // The shared per-iteration solver caches this after the first start.
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
      best,
      attempts,
      remainingTime: 60,
    };
  },
);
