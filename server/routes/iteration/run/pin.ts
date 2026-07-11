// POST /iteration/run/pin
//   - pins (or unpins) the caller's runs on an iteration so a pinned run floats
//     to the top of their OWN runs panel, ahead of the best/recent sort. This is
//     a per-player bookmark of their runs, not a leaderboard concept — it never
//     touches standings.
//   - The panel merges runs that built the identical maze into one row, so a pin
//     toggles the whole maze-group together: the client sends every member run's
//     creation time (ms epoch) and they flip as one (see db/run.ts setRunPinned).
//   - Idempotent (sets an absolute value), so it's safe to retry.

import { z } from "zod";
import { setRunPinned as dbSetRunPinned } from "../../../db/run.ts";
import { method } from "../../apiHelpers.ts";

const setRunPinnedBody = z.object({
  iteration: z.number().min(1),
  // Creation times (ms epoch) of every run in the maze-group being pinned. At
  // most 100 — allRunsByIteration caps a panel at 100 runs, so no group exceeds
  // it.
  created: z.array(z.number()).min(1).max(100),
  pinned: z.boolean(),
});

export const setRunPinned = method(setRunPinnedBody, true)(
  async ({ userId, iteration, created, pinned }) => {
    try {
      await dbSetRunPinned(userId, iteration, created, pinned);
    } catch (err) {
      console.error(err);
      return { error: "failed to pin run", status: 500 };
    }
    return { kind: "setRunPinned" as const, iteration, pinned };
  },
);
