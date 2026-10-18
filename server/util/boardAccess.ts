import { getIteration } from "../db/iteration.ts";
import { rankedAttemptCount } from "../db/run.ts";
import { dailyParts } from "./dailyParts.ts";

// Who may see a day's board outside a ranked attempt: the ONE gate behind every
// surface that returns a board's layout or accepts a build on it (getBoard, and
// so boot/dayView; a free-play startRun; commitRun). For a day D:
//   - D before the caller's local today: open (including the day that just
//     rolled over);
//   - the caller has opened three ranked attempts on D: open;
//   - otherwise (their unfinished today, or a future day): locked.
// Future days must be gated: the gen cron runs a day ahead, so tomorrow's
// iteration exists.
//
// A caller that names no timezone (a cached client's commitRun) is judged in
// the westernmost zone, `Etc/GMT+12`, the strictest reading.
//
// "Local today" is the timezone the client claims, so this is minimal
// anti-cheat on purpose: claiming an earlier zone opens a day, as does spending
// three throwaway attempts on a fresh id. A determined player can multi-account
// or run a solver anyway. The gate only keeps the honest client from stumbling
// onto a puzzle early.
export type BoardAccess = "open" | "locked";

export const ymd = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${
    String(p.day).padStart(2, "0")
  }`;

// The westernmost civil timezone; the reading for a caller that claims none.
export const WESTMOST_TZ = "Etc/GMT+12";

// The pure decision. Dates are `YYYY-MM-DD`, so string order is date order.
export const decideBoardAccess = (s: {
  date: string;
  localToday: string;
  rankedAttempts: number;
}): BoardAccess => {
  if (s.date < s.localToday) return "open";
  return s.rankedAttempts >= 3 ? "open" : "locked";
};

// The iteration's date as `YYYY-MM-DD`. The DATE column reads back as
// `YYYY-MM-DD` (direct transport) or an ISO midnight-Z (proxy); the first ten
// characters are the date either way.
export const iterationDate = (date: unknown) =>
  (date instanceof Date ? date.toISOString() : String(date)).slice(0, 10);

// The caller's access to an iteration's board. Throws UserError on a bad
// timeZone (via dailyParts) and getIteration's "does not exist" Error on an
// unknown iteration.
export const checkBoardAccess = async (
  userId: string,
  iteration: number,
  timeZone?: string,
): Promise<BoardAccess> => {
  const localToday = ymd(dailyParts(timeZone ?? WESTMOST_TZ));
  const date = iterationDate((await getIteration(iteration)).date);

  // The common replay case needs no per-user read.
  if (date < localToday) return "open";

  return decideBoardAccess({
    date,
    localToday,
    rankedAttempts: await rankedAttemptCount(userId, iteration),
  });
};
