import { z } from "zod";
import { getBoard } from "./iteration/board.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { listIterations } from "./iteration/list.ts";
import { standings } from "./iteration/standings.ts";
import { getNotifications } from "./notifications/list.ts";
import { getProfile } from "./profile.ts";
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
// `list` is the calendar's CURRENT month, derived from the caller's timezone so
// it matches the client's local-month key (the client content-keys the prime by
// the same [year, month, 1]..[next] range — see dailyItems.monthListInput). Only
// the current-month calendar fetch consumes it; the prev month keys separately.
const bootBody = z.object({ timeZone: z.string() });

export const boot = method(bootBody, true)(
  async ({ timeZone }, req) => {
    const { year, month } = dailyParts(timeZone); // month is 1-12
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const listInput = {
      start: [year, month, 1] as [number, number, number],
      end: [nextYear, nextMonth, 1] as [number, number, number],
    };

    const [summary, profile, standingsField, notifications, board, list] =
      await Promise.all([
        getDailySummary.handler({ timeZone }, req),
        getProfile.handler({}, req),
        standings.handler({ timeZone }, req),
        getNotifications.handler({}, req),
        getBoard.handler({ timeZone, soft: true }, req),
        listIterations.handler(listInput, req),
      ]);

    return {
      summary,
      profile,
      standings: standingsField,
      notifications,
      board,
      list,
    };
  },
);
