// `setRunPinned` pins or unpins the caller's runs on an iteration so a pinned
// run floats to the top of their OWN runs panel. A private bookmark; it never
// touches standings.
//   - The panel merges identical mazes into one row, so the client sends every
//     member run's creation time (ms epoch) and they flip together (see
//     db/run.ts setRunPinned).
//   - Sets an absolute value, so it is idempotent and retryable.

import { z } from "zod";
import { setRunPinned as dbSetRunPinned } from "../../../db/run.ts";
import { errText, log } from "../../../util/logging.ts";
import { method } from "../../apiHelpers.ts";

const setRunPinnedBody = z.object({
  iteration: z.number().min(1),
  // Creation times (ms epoch) of the maze-group's runs. Max 100: the panel
  // (allRunsByIteration) holds at most 100 runs.
  created: z.array(z.number()).min(1).max(100),
  pinned: z.boolean(),
});

export const setRunPinned = method(setRunPinnedBody, true)(
  async ({ userId, iteration, created, pinned }, req) => {
    try {
      await dbSetRunPinned(userId, iteration, created, pinned);
    } catch (err) {
      log.error(req, "failed to pin run", { error: errText(err) });
      return { error: "failed to pin run", status: 500 };
    }
    return { kind: "setRunPinned" as const, iteration, pinned };
  },
);
