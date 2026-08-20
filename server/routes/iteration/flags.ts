// POST /iteration/flags
//   - stores the caller's flags (the splits tape's manual checkpoints) for one
//     board. Flags belong to the BOARD, not to a run: they persist per player
//     per iteration until cleared, so every replay of that maze is timed
//     against the same marks (see common/splits.ts).
//   - Absolute-value write of the whole set — idempotent, so it's safe to retry
//     and the client can just send whatever is on the board after each edit.
//   - The flags themselves are never validated against the maze: a flag may sit
//     anywhere in the play area, including nowhere near the runner's current
//     route (a speculative mark that reports nothing until a later build routes
//     the runner past it). Only the bounds are checked.

import { z } from "zod";
import { setFlags as dbSetFlags } from "../../db/flags.ts";
import { errText, log } from "../../util/logging.ts";
import { method } from "../apiHelpers.ts";

// The play area is the 20x20 board minus its wall ring, so 1..18 on each axis.
const cell = z.number().int().min(1).max(18);

const setFlagsBody = z.object({
  iteration: z.number().min(1),
  // Well past any sane use of the feature — the tape is a reading surface, not
  // a canvas — but bounded so one player can't grow the row without limit.
  flags: z.array(z.object({ x: cell, y: cell })).max(40),
});

export const setFlags = method(setFlagsBody, true)(
  async ({ userId, iteration, flags }, req) => {
    try {
      await dbSetFlags(userId, iteration, flags);
    } catch (err) {
      log.error(req, "failed to save flags", { error: errText(err) });
      return { error: "failed to save flags", status: 500 };
    }
    return { kind: "setFlags" as const, iteration, flags };
  },
);
