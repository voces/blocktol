import { getIteration } from "../db/iteration.ts";
import { rankedAttemptCount } from "../db/run.ts";
import { dailyParts } from "./dailyParts.ts";

// Who may see a day's board outside a ranked attempt — the ONE gate behind every
// surface that hands back a board's layout or accepts a build on it: getBoard
// (and so boot/dayView, which compose it), a free-play startRun, and commitRun.
//
// The rule is the old "no free play of today's daily before its three ranked
// attempts", widened from `iteration === today` to "today OR LATER" and applied
// on every surface rather than getBoard alone. Before, tomorrow's iteration
// (which exists — the gen cron runs a day ahead) came back from getBoard /
// dayView / boot / a numbered startRun to anyone who asked for its id, and
// commitRun had no gate at all. In order:
//   - D before the caller's local today → open (every past day is replayable,
//     including the one that just rolled over);
//   - the caller has opened three ranked attempts on D → open;
//   - otherwise (their today before it's spent, or a future day) → locked.
//
// A caller that names no timezone (a cached client's commitRun from before
// commits carried one) is judged as if in the westernmost zone, `Etc/GMT+12`:
// the strictest reading, under which only a day closed everywhere (or one it
// has spent its attempts on) is open.
//
// "Local today" is the timezone the client claims, so this is deliberately
// minimal anti-cheat: claiming a zone where today is already yesterday still
// opens it, as does spending three throwaway attempts on a fresh id. Neither is
// worth more machinery — a determined player can also multi-account or run a
// solver. The gate exists so the honest client can't stumble onto a puzzle
// early and so tomorrow's board isn't one request away.
export type BoardAccess = "open" | "locked";

export const ymd = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${
    String(p.day).padStart(2, "0")
  }`;

// The westernmost civil timezone — the fallback reading for a caller that
// claims none (see above).
export const WESTMOST_TZ = "Etc/GMT+12";

// The pure decision. Dates are `YYYY-MM-DD` (so string order is date order).
export const decideBoardAccess = (s: {
  date: string;
  localToday: string;
  rankedAttempts: number;
}): BoardAccess => {
  if (s.date < s.localToday) return "open";
  return s.rankedAttempts >= 3 ? "open" : "locked";
};

// The iteration's date as `YYYY-MM-DD`. Stored as a DATE (migration v14), which
// reads back as `YYYY-MM-DD` (direct transport) or an ISO midnight-Z (proxy) —
// the first ten characters are the date either way. (A Date object, should a
// transport ever hand one back, is UTC midnight of that date.)
export const iterationDate = (date: unknown) =>
  (date instanceof Date ? date.toISOString() : String(date)).slice(0, 10);

// Decide the caller's access to an iteration's board. Throws UserError on a bad
// timeZone (via dailyParts) and the plain "does not exist" Error on an unknown
// iteration, like getIteration.
export const checkBoardAccess = async (
  userId: string,
  iteration: number,
  timeZone?: string,
): Promise<BoardAccess> => {
  const localToday = ymd(dailyParts(timeZone ?? WESTMOST_TZ));
  const date = iterationDate((await getIteration(iteration)).date);

  // A past day needs no per-user read at all — the common replay case.
  if (date < localToday) return "open";

  return decideBoardAccess({
    date,
    localToday,
    rankedAttempts: await rankedAttemptCount(userId, iteration),
  });
};
