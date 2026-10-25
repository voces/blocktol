import { signal } from "@preact/signals";
import type { NotificationKind } from "../../common/notifications.ts";
import { api } from "../api.ts";
import { dayIsBefore, localDay } from "../util/dayBoundary.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { showBoard } from "./board.ts";
import { markReadForDay } from "./notifications.ts";
import {
  fetchStandingsForDate,
  requestStandings,
  setStandingsSort,
  type StandingsSort,
} from "./standings.ts";

// True once the app was opened via a day deep-link this session (a notification
// or a `/YYYYMMDD` permalink). The daily result modal stays hidden on it so it
// doesn't cover the linked day. Sticky for the session.
export const arrivedViaDeepLink = signal(false);

// Gates the view->URL sync until consumeDeepLink has staged any linked day.
// Without it the dock writes "/" on first mount and clobbers the entry URL.
// Flipped true at every exit of consumeDeepLink.
export const viewReady = signal(false);

// Snapshot the entry URL at import, before syncViewUrl can rewrite it.
const entryPath = location.pathname;
const entrySearch = location.search;

// The `/YYYYMMDD` day link we booted onto, if any. A constant parsed at import,
// not the effect-set `arrivedViaDeepLink`, so the boot-time today-staging paths
// can read it whenever they run.
const entryDay = entryPath.match(/^\/(\d{4})(\d{2})(\d{2})$/);
export const entryIsDayLink = entryDay !== null;

// Of those, only the links for a day strictly BEFORE today. This, not the raw
// `entryIsDayLink`, suppresses boot-time today-staging (resume / prestart /
// finished-board prime) so `consumeDeepLink` can win the board with a PAST day.
// A link to TODAY or a FUTURE day must fall through to today's normal flow:
// neither has a board to stage (today's `getBoard` answers { incomplete } until
// the ranked attempts are spent; a future day is locked), so gating on the raw
// link would strand the user on an inert loading board.
//
// It holds only while the link can still win: a past link that fails to
// resolve (a bad date like /20260231, or a transient failure) drops it, see
// abandonPastDayLink. Read it through the function, at the moment it matters.
let pastDayLink = entryDay !== null &&
  dayIsBefore(
    [Number(entryDay[1]), Number(entryDay[2]), Number(entryDay[3])],
    localDay(),
  );
export const stagingPastDayLink = () => pastDayLink;

// Whether boot's summary has landed. By then useInit has already stepped aside
// for the link, so giving the board back means asking for it again.
let summarySeen = false;
api.addEventListener("getDailySummary", () => {
  summarySeen = true;
});

// The past link couldn't be staged: hand the board to today's normal flow
// (resume / prestart / finished board). showBoard can't stand in for it: with
// the daily outstanding it answers { incomplete }. A summary still in flight
// sees the gate down by itself; one already handled is re-requested, which
// resumes an open run but never starts one.
const abandonPastDayLink = () => {
  if (!pastDayLink) return;
  pastDayLink = false;
  if (summarySeen) api.getDailySummary({ timeZone: getTimeZone() });
};

// A pending request to open the profile at its Account section or the
// delete-confirm sheet. Two sources, since the profile BUTTON is hidden while
// today's daily is outstanding:
//   - `?profile=account|delete` on the entry URL (the privacy page's rights
//     cards), read from the entry snapshot like the day link;
//   - requestProfile, from a control outside the button (the prestart overlay's
//     account link).
// Profile takes it once, when it can open (see takeProfileRequest).
export type ProfileRequest = "account" | "delete";
const entryProfile = new URLSearchParams(entrySearch).get("profile");
export const profileRequest = signal<ProfileRequest | null>(
  entryProfile === "account" || entryProfile === "delete" ? entryProfile : null,
);

export const requestProfile = (req: ProfileRequest) => {
  profileRequest.value = req;
};

// Hand the pending request over once, dropping the entry param from the bar so
// a refresh doesn't reopen the sheet. syncViewUrl wouldn't reliably do it: it
// runs only once the dock mounts.
export const takeProfileRequest = (): ProfileRequest | null => {
  const req = profileRequest.peek();
  if (!req) return null;
  profileRequest.value = null;
  const url = new URL(location.href);
  if (url.searchParams.has("profile")) {
    url.searchParams.delete("profile");
    history.replaceState(history.state, "", url.pathname + url.search);
  }
  return req;
};

const pad = (n: number) => String(n).padStart(2, "0");

// Reflect the view in the URL with replaceState (no history entry, so Back
// isn't hijacked): the viewed day in the path (`/` for today), the open board
// in `?board`. A refresh then restores what's on screen, in the PWA too.
export const syncViewUrl = (
  day: readonly [number, number, number] | undefined, // undefined = today
  sheetOpen: boolean,
  sort: StandingsSort,
) => {
  const path = day ? `/${day[0]}${pad(day[1])}${pad(day[2])}` : "/";
  const url = path + (sheetOpen ? `?board=${sort}` : "");
  if (location.pathname + location.search !== url) {
    history.replaceState(null, "", url);
  }
};

// Which board a notification is about: a lost top spot is a PB-board event, a
// finalized daily a ranked-board one.
const sortFor = (kind: NotificationKind): StandingsSort =>
  kind === "lost_top" ? "pb" : "daily";

// Go to a day + board: select the sort, stage the board, and ask the dock to
// surface the leaderboard.
const goToDay = (iteration: number, sort?: StandingsSort) => {
  if (sort) setStandingsSort(sort);
  showBoard(iteration);
  requestStandings(iteration);
};

// In-app panel tap: navigate to the notification's day + board.
export const navigateToNotification = (
  iteration: number,
  kind: NotificationKind,
) => goToDay(iteration, sortFor(kind));

// On boot, restore the view the entry URL points at. `/YYYYMMDD` (the format
// notification pushes use) opens that day's board; `?board=pb|daily` reopens
// the leaderboard sheet on that sort and names the notification kind (pb ->
// lost_top, daily -> daily_final) whose read state a push tap settles. A bare
// `/YYYYMMDD` restores the board with the sheet CLOSED. The client knows the
// date, not the iteration id, so it resolves via standings by date. Never
// throws: a bad day leaves the app on its default landing. Reads the entry
// snapshot, not the live URL.
export const consumeDeepLink = async () => {
  const boardParam = new URLSearchParams(entrySearch).get("board");
  const sort: StandingsSort | undefined = boardParam === "pb"
    ? "pb"
    : boardParam === "daily"
    ? "daily"
    : undefined;

  const m = entryPath.match(/^\/(\d{4})(\d{2})(\d{2})$/);
  if (!m) {
    // No day in the path: a bare `?board` restores today's open sheet and sort.
    if (sort) {
      setStandingsSort(sort);
      requestStandings(undefined);
    }
    viewReady.value = true;
    return;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const kind: NotificationKind | null = boardParam === "pb"
    ? "lost_top"
    : boardParam === "daily"
    ? "daily_final"
    : null;

  arrivedViaDeepLink.value = true;
  try {
    const s = await fetchStandingsForDate(year, month, day);
    // The link didn't resolve to a day: fall back to today.
    if (!s) return abandonPastDayLink();
    if (sort) setStandingsSort(sort);
    // Stage a PAST day's board here, awaited so the sync gate opens only once
    // it is staged. A today-link leaves staging to `useInit`, which owns
    // today's resume / prestart; staging it here would stage nothing or race
    // that flow. A past board that won't stage falls back like an unresolved
    // link. Reopen the sheet only when the link says it was open.
    if (stagingPastDayLink() && !(await showBoard(s.iteration))) {
      return abandonPastDayLink();
    }
    if (boardParam) {
      requestStandings(s.iteration);
      // Tapping the push counts as reading its notification.
      if (kind) markReadForDay(s.iteration, kind);
    }
  } catch {
    abandonPastDayLink();
  } finally {
    viewReady.value = true;
  }
};
