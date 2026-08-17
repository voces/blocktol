import { signal } from "@preact/signals";
import type { NotificationKind } from "../../common/notifications.ts";
import { dayIsBefore, localDay } from "../util/dayBoundary.ts";
import { showBoard } from "./board.ts";
import { markReadForDay } from "./notifications.ts";
import {
  fetchStandingsForDate,
  requestStandings,
  setStandingsSort,
  StandingsSort,
} from "./standings.ts";

// True once the app was opened via a day deep-link this session (a notification
// or a `/YYYYMMDD` permalink). The daily result modal reads it and stays hidden
// so it doesn't cover the day the link points at (the Today panel and the
// standings sheet still carry the numbers). Sticky for the session.
export const arrivedViaDeepLink = signal(false);

// Gate the view→URL sync until boot has settled the initial view (consumeDeepLink
// has run and staged any deep-linked day). Without it the dock writes "/" on
// first mount — before the deep link is restored — clobbering the entry URL and
// flashing the bar back to root. Flipped true at every exit of consumeDeepLink.
export const viewReady = signal(false);

// Snapshot the entry URL at import — before the view can rewrite it via
// syncViewUrl on first mount — so the boot deep-link reads where we actually
// landed, not wherever the sync has since moved the bar.
const entryPath = location.pathname;
const entrySearch = location.search;

// The `/YYYYMMDD` day link we booted onto, if any — parsed synchronously at
// import so the boot-time today-staging paths can read it before they run. A
// plain constant, not the effect-set `arrivedViaDeepLink`, so the gate is
// reliable no matter when each boot path runs.
const entryDay = entryPath.match(/^\/(\d{4})(\d{2})(\d{2})$/);
export const entryIsDayLink = entryDay !== null;

// Of those, only the links for a day strictly BEFORE today. This — not the raw
// `entryIsDayLink` — is what suppresses boot-time today-staging (resume /
// prestart / finished-board prime): the suppression exists so `consumeDeepLink`
// can win the board with a PAST day (past boards are ungated and replayable).
// A link to TODAY has no other day to stage, and a FUTURE day must not be
// staged at all — tomorrow's puzzle is one you'll rank tomorrow (previewing it
// is a leak) and next week's doesn't exist yet. Both fall through to today's
// normal flow instead. Gating on the raw day-link stranded a fresh user on a
// today-or-future permalink (today's `getBoard` answers { incomplete } until the
// three ranked attempts are spent; a future date 400s or, worse, served
// tomorrow's board), leaving an inert loading board with no way forward.
export const entryIsPastDayLink = entryDay !== null &&
  dayIsBefore(
    [Number(entryDay[1]), Number(entryDay[2]), Number(entryDay[3])],
    localDay(),
  );

const pad = (n: number) => String(n).padStart(2, "0");

// Reflect the current view in the URL (replaceState — no history entry, so Back
// isn't hijacked): the viewed day in the path (`/` for today), the open board in
// `?board`. So a refresh restores exactly what's on screen — the PWA included,
// where the bar is invisible — and web links stay meaningful and shareable.
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

// Go to a day + board: select the sort, stage that day's board, and ask the dock
// to surface the leaderboard once it's there. Shared by the in-app panel tap
// (which already has the iteration id) and the permalink boot below.
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
// notification pushes use) opens that day's board; `?board=pb|daily` reopens the
// leaderboard sheet on that sort AND names the notification kind (pb → lost_top,
// daily → daily_final) whose read state a push tap settles. A bare `/YYYYMMDD`
// (no board) restores the board with the sheet CLOSED, so refreshing after you
// closed it doesn't re-pop it. The client knows the date, not the iteration id,
// so it resolves via the standings endpoint (whose response also warms the
// sheet). Never throws — a bad/unknown day just leaves the app on its default
// landing. Reads the entry snapshot, not the live URL (the view sync may have
// already moved the bar by the time this runs).
export const consumeDeepLink = async () => {
  const boardParam = new URLSearchParams(entrySearch).get("board");
  const sort: StandingsSort | undefined = boardParam === "pb"
    ? "pb"
    : boardParam === "daily"
    ? "daily"
    : undefined;

  const m = entryPath.match(/^\/(\d{4})(\d{2})(\d{2})$/);
  if (!m) {
    // No day in the path — a bare `?board` restores today's open sheet + sort.
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
    // The link didn't resolve to a day — fall back to today (boot's own
    // today-staging stepped aside for the link, so nothing else will).
    if (!s) {
      showBoard();
      return;
    }
    if (sort) setStandingsSort(sort);
    // Stage a PAST day's board here; only reopen the sheet when the link says it
    // was open (the view sync then keeps the URL honest as you interact). Awaited
    // so the sync gate opens only once the day is actually staged. A today-link
    // hands staging to the normal boot flow instead — `useInit` owns today's
    // resume / prestart, and today's board stays { incomplete } until the ranked
    // attempts are spent, so staging it here would stage nothing (or race that
    // flow).
    if (entryIsPastDayLink) await showBoard(s.iteration);
    if (boardParam) {
      requestStandings(s.iteration);
      // Tapping the push counts as reading its notification.
      if (kind) markReadForDay(s.iteration, kind);
    }
  } catch {
    showBoard(); // same fallback to today on error
  } finally {
    viewReady.value = true;
  }
};
