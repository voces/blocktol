import { z } from "zod";
import { getBoard } from "./iteration/board.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { listIterations } from "./iteration/list.ts";
import { standings } from "./iteration/standings.ts";
import { getNotifications } from "./notifications/list.ts";
import { getProfile } from "./profile.ts";
import { getDailyIterationId } from "../db/iteration.ts";
import { dailyParts } from "../util/dailyParts.ts";
import { method } from "./apiHelpers.ts";

// One request for the whole cold boot: runs the boot handlers (getDailySummary,
// getProfile, standings, getNotifications, getBoard, list) in parallel and
// bundles the results, so the client primes each off this single fetch (client
// `primeBoot`).
//
// It composes the handlers rather than reimplementing them, so each keeps its
// tested semantics (getDailySummary never opens a ranked attempt; getBoard's
// free-play gate). Each re-derives userId from the request (apiHelpers.method).
//
// An unfinished daily's `board` is `{ incomplete }` (200); the client stages
// the summary's currentRun instead.
//
// `list` is the calendar's two mount months, `[current, prev]`, derived from
// the caller's timezone so they match the client's content keys (see
// dailyItems.monthListInput). A prev month the calendar doesn't show goes
// unconsumed.
//
// `day` is a `/YYYYMMDD` permalink cold load: boot also resolves that date to
// its iteration and bundles the day's board + standings as `linked` (see client
// `primeBoot`). `dayView` is the warm in-app twin. A date with no daily gives
// `linked: null` and the client falls through.
const bootBody = z.object({
  timeZone: z.string(),
  day: z.tuple([z.number(), z.number(), z.number()]).optional(),
});

type YMD = [number, number, number];
// The [start, end) range for a month (month 1-12), matching monthListInput.
const monthRange = (year: number, month: number): { start: YMD; end: YMD } => {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: [year, month, 1], end: [nextYear, nextMonth, 1] };
};

export const boot = method(bootBody, true)(
  async ({ timeZone, day }, req) => {
    const { year, month } = dailyParts(timeZone); // month is 1-12
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;

    // Both linked reads key off the iteration, so resolve it before the
    // fan-out. Non-throwing: an unknown date yields undefined → linked: null.
    const linkedIteration = day
      ? await getDailyIterationId(day[0], day[1], day[2])
      : undefined;

    const [
      summary,
      profile,
      standingsField,
      notifications,
      board,
      listCurrent,
      listPrev,
      linkedBoard,
      linkedStandings,
    ] = await Promise.all([
      getDailySummary.handler({ timeZone }, req),
      getProfile.handler({}, req),
      standings.handler({ timeZone }, req),
      getNotifications.handler({}, req),
      getBoard.handler({ timeZone }, req),
      listIterations.handler(monthRange(year, month), req),
      listIterations.handler(monthRange(prevYear, prevMonth), req),
      // The same calls as dayView, so the client primes them under showBoard's
      // keys. A link to TODAY with the daily unfinished answers { incomplete };
      // showBoard re-requests once the attempts are spent (store/board.ts).
      linkedIteration !== undefined
        ? getBoard.handler({ iteration: linkedIteration, timeZone }, req)
        : Promise.resolve(undefined),
      linkedIteration !== undefined
        ? standings.handler({ iteration: linkedIteration }, req)
        : Promise.resolve(undefined),
    ]);

    return {
      summary,
      profile,
      standings: standingsField,
      notifications,
      board,
      // [current, prev]
      list: [listCurrent, listPrev],
      // Null for a bare `/` boot or an unresolvable date. `iteration` keys the
      // primes the deep-link handler consumes.
      linked: linkedIteration !== undefined
        ? {
          iteration: linkedIteration,
          board: linkedBoard,
          standings: linkedStandings,
        }
        : null,
    };
  },
);
