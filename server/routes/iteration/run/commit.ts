// POST /iteration/run/commit
//   - marks the caller's current free-play run non-void, so it counts once it
//     actually executes (timer expiry or an explicit start).
//   - Free-play only: commitRun is scoped to daily = FALSE. Daily attempts
//     already commit on build, so this never touches them.
//   - The client calls this at the moment the run begins executing; leaving
//     before then keeps the run void (abandoned).

import { z } from "zod";
import { commitRun as dbCommitRun } from "../../../db/run.ts";
import { checkLostTop } from "../../../util/lostTop.ts";
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
    // The committed run just entered the PB field: if it passed (or tied) another
    // player's leading build, notify them they lost the top spot. Awaited on
    // purpose — this Deploy kills work left running after the response — but the
    // check short-circuits after one (parallel) round trip when nothing changed,
    // and only touches the notifier when someone was actually displaced.
    // checkLostTop never throws, so it can't fail the commit.
    await checkLostTop(iteration, userId);
    // The iteration rides back so the client can refresh that day's standings —
    // a committed free-play run just entered the field and may move the PB board.
    return { kind: "commitRun" as const, iteration };
  },
);
