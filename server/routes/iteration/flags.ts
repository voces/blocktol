// `setFlags` stores the caller's flags (the splits tape's manual checkpoints)
// for one board. Flags belong to the BOARD, not a run: they persist per player
// per iteration until cleared, so every build is timed against the same marks
// (see common/splits.ts).
//   - Absolute write of the whole set: idempotent, so retryable.
//   - Flags aren't validated against the maze, only the bounds: a flag may sit
//     off the current route and report nothing until a later build passes it.

import { z } from "zod";
import { setFlags as dbSetFlags } from "../../db/flags.ts";
import { errText, log } from "../../util/logging.ts";
import { method } from "../apiHelpers.ts";

// The play area is the 20x20 board minus its wall ring, so 1..18 on each axis.
const cell = z.number().int().min(1).max(18);

const setFlagsBody = z.object({
  iteration: z.number().min(1),
  // Far past real use; bounds the row's size.
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
