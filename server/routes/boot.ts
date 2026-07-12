import { z } from "zod";
import { getBoard } from "./iteration/board.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { listIterations } from "./iteration/list.ts";
import { standings } from "./iteration/standings.ts";
import { getNotifications } from "./notifications/list.ts";
import { getProfile } from "./profile.ts";
import { method } from "./apiHelpers.ts";

// One round trip for the whole cold boot. The app used to fan out ~8 calls in
// two serial waves — getDailySummary/getProfile/standings/getBoard/list/
// getNotifications in parallel, then a SECOND wave (a redundant standings + list
// refetch) that the first wave's responses cascaded, roughly doubling
// time-to-quiet. This composes the existing handlers in parallel and bundles
// their results, so the client hydrates every boot store from a single response
// with no second wave.
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
// the old soft-primed getBoard did. `list` returns the current month (its
// default), covering the calendar's mount fetch.
const bootBody = z.object({ timeZone: z.string() });

export const boot = method(bootBody, true)(
  async ({ timeZone }, req) => {
    const [summary, profile, standingsField, notifications, list, board] =
      await Promise.all([
        getDailySummary.handler({ timeZone }, req),
        getProfile.handler({}, req),
        standings.handler({ timeZone }, req),
        getNotifications.handler({}, req),
        listIterations.handler({}, req),
        getBoard.handler({ timeZone, soft: true }, req),
      ]);

    return {
      summary,
      profile,
      standings: standingsField,
      notifications,
      list,
      board,
    };
  },
);
