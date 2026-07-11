import { signal } from "@preact/signals";
import type { NotificationKind } from "../../common/notifications.ts";
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

// Whether we booted onto a `/YYYYMMDD` day link — known synchronously at import,
// so boot-time today-staging (the daily auto-start / resume / finished-board
// prime) can bow out and let consumeDeepLink stage the linked day without a
// race. A plain constant, not the effect-set `arrivedViaDeepLink`, so the gate
// is reliable no matter when each boot path runs.
export const entryIsDayLink = /^\/(\d{4})(\d{2})(\d{2})$/.test(entryPath);

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
  console.log(
    "DL: consumeDeepLink entryPath=",
    entryPath,
    "entryIsDayLink=",
    entryIsDayLink,
    "match=",
    !!m,
    "board=",
    boardParam,
  );
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
    console.log("DL: standings resolved=", !!s, "iteration=", s && s.iteration);
    // The link didn't resolve to a day — fall back to today (boot's own
    // today-staging stepped aside for the link, so nothing else will).
    if (!s) {
      showBoard();
      return;
    }
    if (sort) setStandingsSort(sort);
    // Always stage the day's board; only reopen the sheet when the link says it
    // was open (the view sync then keeps the URL honest as you interact). Awaited
    // so the sync gate opens only once the day is actually staged.
    const staged = await showBoard(s.iteration);
    console.log("DL: showBoard(", s.iteration, ") staged=", staged);
    if (boardParam) {
      requestStandings(s.iteration);
      // Tapping the push counts as reading its notification.
      if (kind) markReadForDay(s.iteration, kind);
    }
  } catch (e) {
    console.log("DL: consumeDeepLink error", e);
    showBoard(); // same fallback to today on error
  } finally {
    viewReady.value = true;
    console.log("DL: viewReady=true");
  }
};
