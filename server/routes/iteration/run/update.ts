import { z } from "zod";
import { findPathFromData, pathDuration } from "../../../../common/pathing.ts";
import { is, isRecord } from "../../../../common/typeguards.ts";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { updateCurrentRun } from "../../../db/run.ts";
import { log } from "../../../util/logging.ts";
import { trailer } from "../../../util/memoize.ts";
import { method } from "../../apiHelpers.ts";

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

    if (blocks.length > iteration.bricks) {
      return { error: "too many blocks", status: 400 };
    }

    if (blocks.filter((b) => b.thunder).length > iteration.power) {
      return { error: "too many slows", status: 400 };
    }

    let path: ReturnType<typeof findPathFromData>;
    try {
      path = findPathFromData(
        [...iteration.blocks, ...blocks],
        iteration.checkpoint,
      );
    } catch (err) {
      console.error(err);
      return { error: "invalid path", status: 400 };
    }

    if (!path) return { error: "invalid path", status: 400 };

    const [duration, slows] = pathDuration(
      path,
      [
        ...iteration.blocks.filter((b) => b.thunder),
        ...blocks.filter((b) => b.thunder),
      ],
    );

    updateCurrentRun(
      userId,
      duration,
      blocks.map((b) => ({ ...b, player: true })),
    ).then((r) => {
      if (isUpdate(r) && r.changedRows === 0) {
        log.error(req, "Unexpected no rows changed");
      }
    }).catch((err) => log.error(req, err));

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
