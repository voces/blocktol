import { z } from "zod";
import { getBoard } from "./iteration/board.ts";
import { standings } from "./iteration/standings.ts";
import { method } from "./apiHelpers.ts";

// One request for a day navigation: a chosen iteration's board + its standings.
// A calendar click / view-best / notification jump used to fire getBoard (from
// showBoard) AND standings (the dock reacting to the iteration change) as two
// separate requests; this composes them — boot, but for one arbitrary day.
//
// Composition (not reimplementation): each sub-handler keeps its tested semantics
// (getBoard's free-play gate, standings' cached field) and re-derives userId from
// the request (apiHelpers.method). getBoard is NOT soft here — a real navigation
// targets an unlocked day, matching the non-soft getBoard showBoard itself sends,
// so the client can prime it under the same key.
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
