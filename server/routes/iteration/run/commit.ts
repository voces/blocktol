// `commitRun`: free play only (ranked attempts commit on build). The client
// calls it when the run starts executing; leaving earlier abandons the run.
// Two shapes, for cached clients:
//   - { iteration, blocks, clientId }: the current client. Free play is local,
//     so the whole maze arrives here. Validate it (legality, and the
//     authoritative time from the shared engine; only the 60s build budget is
//     trusted to the client) and INSERT, idempotent on clientId.
//   - { iteration }: a legacy client that did startRun + updateRun. Its row
//     exists with the maze; flip it non-void.

import { z } from "zod";
import {
  commitRun as dbCommitRun,
  insertFreePlayRun,
} from "../../../db/run.ts";
import { getIteration } from "../../../db/iteration.ts";
import { onPbBuild } from "../../../util/pbBoard.ts";
import { checkBoardAccess } from "../../../util/boardAccess.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { errText, log } from "../../../util/logging.ts";
import { UserError } from "../../../util/UserError.ts";
import { method } from "../../apiHelpers.ts";
import { piece } from "./piece.ts";

const commitRunBody = z.object({
  iteration: z.number().min(1),
  // Absent from legacy clients, whose commit takes the flip-void path below.
  // Capped at 400 (> the board's 324 interior cells) so an oversized maze is
  // rejected before validateRun's per-piece walk; see updateRun.
  blocks: z.array(piece).max(400).optional(),
  clientId: z.string().min(1).max(64).optional(),
  // For the board gate's "today or later". Optional for cached clients that
  // omit it; the gate then assumes the westernmost zone (util/boardAccess.ts).
  timeZone: z.string().optional(),
});

export const commitRun = method(commitRunBody, true)(
  async ({ userId, iteration, blocks, clientId, timeZone }, req) => {
    // The run's server-assigned created (ms epoch), so the client can pin the
    // just-executed run off its optimistic panel row (see insertFreePlayRun).
    // Null on the legacy flip-void path, which renders no optimistic row.
    let created: number | null = null;

    // The board gate (util/boardAccess.ts), for both shapes: a commit must not
    // land on a locked board (it would enter the PB field, and on a rankable
    // day add a row startRun's @priorRuns counts), nor answer with
    // validateRun's reasons, which would map a locked board cell by cell.
    try {
      if (await checkBoardAccess(userId, iteration, timeZone) === "locked") {
        return { error: "board locked", status: 403 };
      }
    } catch (err) {
      // A bad timeZone or unknown iteration is the caller's fault (400/404).
      if (err instanceof UserError) throw err;
      log.error(req, "failed to check board access", { error: errText(err) });
      return { error: "failed to commit run", status: 500 };
    }

    try {
      if (blocks && clientId) {
        const data = await getIteration(iteration);
        const validation = validateRun(data, blocks);
        if (!validation.ok) return { error: validation.reason, status: 400 };
        created = await insertFreePlayRun(
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
      log.error(req, "failed to commit run", { error: errText(err) });
      return { error: "failed to commit run", status: 500 };
    }
    // The run just entered the PB field: send lost-top notifications and the
    // Discord top-PB post/edit. Awaited so the shutdown drain covers it: work
    // left running after the response dies with a deploy's restart. Never
    // throws, so it can't fail the commit.
    await onPbBuild(iteration, userId);
    // The iteration lets the client refresh that day's standings.
    return { kind: "commitRun" as const, iteration, created };
  },
);
