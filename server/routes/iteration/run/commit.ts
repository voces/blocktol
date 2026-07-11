// POST /iteration/run/commit
//   - Free-play only (daily attempts already commit on build, so this never
//     touches them). The client calls it the moment the run begins executing;
//     leaving before then means the run is never committed (abandoned).
//   - Two shapes, for backwards compatibility with cached clients:
//       * { iteration, blocks, clientId } — the current client. Free play runs
//         entirely locally (no startRun/updateRun), so the whole maze arrives
//         here. Validate it server-side (legality + the authoritative time from
//         the shared engine — only the 60s build budget is trusted to the
//         client) and INSERT the run, idempotent on clientId.
//       * { iteration } — a legacy client that still start+update+bare-committed.
//         Its row already exists with the maze; just flip it non-void.

import { z } from "zod";
import {
  commitRun as dbCommitRun,
  insertFreePlayRun,
} from "../../../db/run.ts";
import { getIteration } from "../../../db/iteration.ts";
import { checkLostTop } from "../../../util/lostTop.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { method } from "../../apiHelpers.ts";

const commitRunBody = z.object({
  iteration: z.number().min(1),
  // New (commit-only free play). Absent from legacy clients — zod strips the
  // unknown `freePlay` key an old client may still send, and their commit falls
  // through to the flip-void path below.
  blocks: z.array(
    z.object({ x: z.number(), y: z.number(), thunder: z.boolean().optional() }),
  ).optional(),
  clientId: z.string().min(1).max(64).optional(),
});

export const commitRun = method(commitRunBody, true)(
  async ({ userId, iteration, blocks, clientId }) => {
    try {
      if (blocks && clientId) {
        const data = await getIteration(iteration);
        const validation = validateRun(data, blocks);
        if (!validation.ok) return { error: validation.reason, status: 400 };
        await insertFreePlayRun(
          userId,
          iteration,
          validation.duration,
          blocks,
          clientId,
        );
      } else {
        await dbCommitRun(userId, iteration);
      }
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
