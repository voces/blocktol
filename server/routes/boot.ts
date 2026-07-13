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

// One request for the whole cold boot. The app used to fan out ~8 calls in two
// serial waves — getDailySummary/getProfile/standings/getBoard/list/
// getNotifications in parallel, then a SECOND wave (a redundant standings + list
// refetch) that the first wave's responses cascaded, roughly doubling
// time-to-quiet. This composes the boot handlers in parallel and bundles their
// results, so the client primes each off this single fetch (see client
// `primeBoot`) with no second wave.
//
// Composition (not reimplementation) is deliberate: each sub-handler keeps its
// exact, tested semantics — including getDailySummary's server-side auto-start of
// the next ranked attempt and getBoard's free-play gate — and re-derives userId
// from the request itself (see apiHelpers.method), so nothing is threaded. On the
// cohost these run against the local DB with the per-iteration solver cache and
// the standings LRU warm, so the fan-out is a handful of cheap parallel reads.
//
// getBoard runs with `soft` so an unfinished daily comes back `{ incomplete }`
// (200) rather than a 403 — the client stages currentRun (from the summary) when
// present and only falls back to this board once the daily is done, exactly as
// the old soft-primed getBoard did.
//
// `list` is the calendar's two mount months — CURRENT and PREV — derived from
// the caller's timezone so they match the client's local-month keys (the client
// content-keys each prime by the same [year, month, 1]..[next] range — see
// dailyItems.monthListInput). Returned as `[current, prev]`; the client primes
// each month under its own key, so both the current- and prev-month calendar
// fetches consume boot's slices. (When the calendar shows only the current month
// — mobile / late in the month — the prev prime simply goes unconsumed.)
//
// `day` is the cold-load-onto-a-particular-day case: a `/YYYYMMDD` permalink (a
// notification tap, a shared link, or just reloading while viewing a past day —
// the view sync writes that day into the URL). When present, boot ALSO resolves
// that date to its iteration and bundles the linked day's board + standings, so
// a day-link boot collapses to this one request too (see client `primeBoot`'s
// `day` branch). `dayView` stays the WARM in-app day navigation; this is its
// cold-boot twin. A date with no daily resolves to `linked: null` and the client
// falls through (its deep-link handler already tolerates an unresolvable day).
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

    // The linked day's iteration must be known before its board/standings can
    // join the fan-out (both key off it), so resolve it up front — one fast
    // indexed lookup ahead of the parallel reads. Non-throwing: an unknown date
    // yields undefined → linked: null.
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
      getBoard.handler({ timeZone, soft: true }, req),
      listIterations.handler(monthRange(year, month), req),
      listIterations.handler(monthRange(prevYear, prevMonth), req),
      // getBoard is NOT soft here — a real day navigation targets an unlocked
      // day, matching the non-soft getBoard showBoard sends (so the client primes
      // it under the same key). Same composition as dayView.
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
      // [current, prev] — the client primes each under its month key.
      list: [listCurrent, listPrev],
      // The linked day's slices (board + standings), or null for a bare `/` boot
      // or an unresolvable date. `iteration` lets the client key the primes the
      // deep-link handler consumes (getBoard/standings by iteration).
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
