// POST /iteration/run/abandon
//   - voids the caller's current free-play run so the attempt is discarded
//     (dropped from the panel / never counted).
//   - Free-play only: voidCurrentRun is scoped to daily = FALSE, so a spent
//     daily attempt can't be erased this way.
//
// DEPRECATED (2026-07-06): free-play runs are now void until they execute (see
// commitRun), so re-staging already abandons an in-progress build and the client
// no longer calls this. Kept temporarily so an older cached client doesn't 404;
// safe to remove after ~2026-07-13 once those clients have refreshed.

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
