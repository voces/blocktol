import { getIteration } from "../db/iteration.ts";
import { boardAccessState, recordPreview } from "../db/preview.ts";
import { dailyParts } from "./dailyParts.ts";

// Who may see a day's board outside a ranked attempt — the ONE gate behind every
// surface that hands back a board's layout or accepts a build on it: getBoard
// (and so boot/dayView, which compose it), a free-play startRun, and commitRun.
//
// The thing being protected is "no one sees a puzzle before ranking it". A day D
// can still be RANKED by anyone whose local date is D, and local dates span
// UTC+14 to UTC−12 — so D stays rankable somewhere until it ends in UTC−12
// (`Etc/GMT+12`; timezones are IANA-only, so nothing lies further west). The old
// gate compared against "today" in the timezone the CLIENT claims, which was
// trivially dodged: claim a zone where today isn't today (or ask for tomorrow's
// id — the gen cron runs a day ahead) and the board came back.
//
// The decision, in order:
//   - D is no longer rankable anywhere → open (a closed day is public).
//   - the player has spent their three ranked attempts on it → open.
//   - D is the player's local today, or later → locked. Today is the existing
//     "not yet"; a future day is one no honest client asks for.
//   - D is before the player's local today but still rankable to the west →
//     open, as a PREVIEW: the player saw a board they could, by claiming a
//     western timezone, still rank. That is recorded (db/preview.ts), and
//     startRun refuses a ranked attempt on a previewed board. An honest client
//     only ever ranks its own local today, which it can never preview, so the
//     marker only ever bites the trick.
export type BoardAccess = "open" | "preview" | "locked";

export const ymd = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${
    String(p.day).padStart(2, "0")
  }`;

// The westernmost civil timezone: a date still current here is still rankable
// by someone.
export const WESTMOST_TZ = "Etc/GMT+12";

// The pure decision. Dates are `YYYY-MM-DD` (so string order is date order).
// `localToday` null means the caller claimed no timezone (commitRun): it can't
// be granted a fresh preview, but one it was already granted (`previewed`)
// stands — a commit only follows a board it was shown, and every way a board
// opens is monotonic in time (a day only ever leaves the rankable window; spent
// attempts stay spent), so "open then" implies "open now".
export const decideBoardAccess = (s: {
  date: string;
  westToday: string;
  localToday: string | null;
  rankedAttempts: number;
  previewed: boolean;
}): BoardAccess => {
  if (s.date < s.westToday) return "open";
  if (s.rankedAttempts >= 3) return "open";
  if (s.localToday === null) return s.previewed ? "open" : "locked";
  if (s.date >= s.localToday) return "locked";
  return "preview";
};

// The iteration's date as `YYYY-MM-DD`. Stored as a DATE (migration v14), which
// reads back as `YYYY-MM-DD` (direct transport) or an ISO midnight-Z (proxy) —
// the first ten characters are the date either way. (A Date object, should a
// transport ever hand one back, is UTC midnight of that date.)
export const iterationDate = (date: unknown) =>
  (date instanceof Date ? date.toISOString() : String(date)).slice(0, 10);

// Decide (and, for a preview, record) the caller's access to an iteration's
// board. Throws UserError on a bad timeZone (via dailyParts) and the plain
// "does not exist" Error on an unknown iteration, like getIteration. The marker
// is written BEFORE the caller hands the board back, so a board is never shown
// without the record that it was.
export const checkBoardAccess = async (
  userId: string,
  iteration: number,
  timeZone?: string,
): Promise<BoardAccess> => {
  const localToday = timeZone ? ymd(dailyParts(timeZone)) : null;
  const westToday = ymd(dailyParts(WESTMOST_TZ));
  const date = iterationDate((await getIteration(iteration)).date);

  // A closed day needs no per-user read at all — the common replay case.
  if (date < westToday) return "open";

  const { rankedAttempts, previewed } = await boardAccessState(
    userId,
    iteration,
  );
  const access = decideBoardAccess({
    date,
    westToday,
    localToday,
    rankedAttempts,
    previewed,
  });
  if (access === "preview" && !previewed) {
    await recordPreview(userId, iteration);
  }
  return access;
};
