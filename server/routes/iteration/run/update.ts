import { z } from "zod";
import { findPathFromData, pathDuration } from "../../../../common/pathing.ts";
import {
  getIteration,
  getIterationOtherBest as getIterationOtherBestRaw,
} from "../../../db/iteration.ts";
import { updateCurrentRun } from "../../../db/run.ts";
import { trailer } from "../../../util/memoize.ts";
import { method } from "../../apiHelpers.ts";

const updateRunBody = z.object({
  iteration: z.number(),
  blocks: z.array(
    z.object({ x: z.number(), y: z.number(), thunder: z.boolean().optional() }),
  ),
});

const getIterationOtherBest = trailer(getIterationOtherBestRaw);

export const updateRun = method(updateRunBody, true)(
  async ({ iteration: iterationId, blocks, userId }) => {
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
    ).catch(console.error);

    return { path, duration, slows, supreme: duration > (otherBest ?? 0) };
  },
);
