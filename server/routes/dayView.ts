import { z } from "zod";
import { getBoard } from "./iteration/board.ts";
import { standings } from "./iteration/standings.ts";
import { method } from "./apiHelpers.ts";

// One request for a day navigation: an iteration's board + its standings, which
// a calendar click or view-best would otherwise fetch separately (getBoard from
// showBoard, standings from the dock). Boot for one arbitrary day.
//
// Composes the sub-handlers, which keep their semantics (getBoard's free-play
// gate) and re-derive userId from the request. The getBoard call matches
// showBoard's, so the client primes it under the same key, including the
// { incomplete } an unfinished today answers with.
const dayViewBody = z.object({
  iteration: z.number().min(1),
  timeZone: z.string(),
});

export const dayView = method(dayViewBody, true)(
  async ({ iteration, timeZone }, req) => {
    const [board, standingsField] = await Promise.all([
      getBoard.handler({ iteration, timeZone }, req),
      standings.handler({ iteration }, req),
    ]);
    return { board, standings: standingsField };
  },
);
