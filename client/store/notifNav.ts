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

// On boot, route a `/YYYYMMDD` day permalink (the format notification pushes
// use). `?board=pb|daily` selects the sort. The client knows the date, not the
// iteration id, so it resolves via the standings endpoint (whose response also
// warms the sheet). Never throws — a bad/unknown day just leaves the app on its
// default landing.
export const consumeDeepLink = async () => {
  const m = location.pathname.match(/^\/(\d{4})(\d{2})(\d{2})$/);
  if (!m) return;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const boardParam = new URLSearchParams(location.search).get("board");
  const sort: StandingsSort | undefined = boardParam === "pb"
    ? "pb"
    : boardParam === "daily"
    ? "daily"
    : undefined;
  // The board selects the sort AND identifies the notification kind that linked
  // here (pb → lost_top, daily → daily_final); a plain permalink has no board
  // and marks nothing read.
  const kind: NotificationKind | null = boardParam === "pb"
    ? "lost_top"
    : boardParam === "daily"
    ? "daily_final"
    : null;

  arrivedViaDeepLink.value = true;
  try {
    const s = await fetchStandingsForDate(year, month, day);
    if (!s) return;
    goToDay(s.iteration, sort);
    // Tapping the push counts as reading its notification.
    if (kind) markReadForDay(s.iteration, kind);
  } catch {
    // leave the app on its default landing
  }
};
