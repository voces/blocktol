// POST /iteration/run/abandon
//   - voids the caller's current free-play run so the attempt is discarded
//     (dropped from the panel / never counted).
//   - Free-play only: voidCurrentRun is scoped to daily = FALSE, so a spent
//     daily attempt can't be erased this way.
//   - The client follows this with getBoard to re-stage a fresh board.

import { z } from "zod";
import { voidCurrentRun } from "../../../db/run.ts";
import { method } from "../../apiHelpers.ts";

const abandonRunBody = z.object({
  iteration: z.number().min(1),
});

export const abandonRun = method(abandonRunBody, true)(
  async ({ userId, iteration }) => {
    try {
      await voidCurrentRun(userId, iteration);
    } catch (err) {
      console.error(err);
      return { error: "failed to abandon run", status: 500 };
    }
    return { kind: "abandonRun" as const };
  },
);
