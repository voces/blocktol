// POST /iteration/run/commit
//   - marks the caller's current free-play run non-void, so it counts once it
//     actually executes (timer expiry or an explicit start).
//   - Free-play only: commitRun is scoped to daily = FALSE. Daily attempts
//     already commit on build, so this never touches them.
//   - The client calls this at the moment the run begins executing; leaving
//     before then keeps the run void (abandoned).

import { z } from "zod";
import { commitRun as dbCommitRun } from "../../../db/run.ts";
import { method } from "../../apiHelpers.ts";

const commitRunBody = z.object({
  iteration: z.number().min(1),
});

export const commitRun = method(commitRunBody, true)(
  async ({ userId, iteration }) => {
    try {
      await dbCommitRun(userId, iteration);
    } catch (err) {
      console.error(err);
      return { error: "failed to commit run", status: 500 };
    }
    return { kind: "commitRun" as const };
  },
);
