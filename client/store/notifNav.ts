import { signal } from "@preact/signals";
import type { NotificationKind } from "../../common/notifications.ts";
import { showBoard } from "./board.ts";
import { requestStandings, setStandingsSort } from "./standings.ts";

// True once the app was opened FROM a push notification this session. The daily
// result modal reads it and stays hidden so it doesn't cover the day the
// notification points at (the Today panel and the standings sheet still carry
// the numbers). Sticky for the session — they arrived via a notification, so the
// big result card stays out of the way.
export const arrivedFromNotification = signal(false);

// Which board a notification is about: a lost top spot is a PB-board event, a
// finalized daily a ranked-board one.
const sortFor = (kind: NotificationKind) =>
  kind === "lost_top" ? "pb" : "daily";

// Go to the day + board a notification is about: select its sort, stage that
// day's board, and ask the dock to surface the leaderboard once it's there.
// Shared by the in-app panel tap and the push deep-link below.
export const navigateToNotification = (
  iteration: number,
  kind: NotificationKind,
) => {
  setStandingsSort(sortFor(kind));
  showBoard(iteration);
  requestStandings(iteration);
};

// On boot, route a push deep-link — `/?notif=<iteration>&kind=<kind>`, set by the
// server's push payload — then strip it from the URL so a refresh doesn't re-fire.
// Flags the arrival so the daily result modal steps aside for the destination.
export const consumeNotificationDeepLink = () => {
  const params = new URLSearchParams(location.search);
  const raw = params.get("notif");
  if (!raw) return;
  history.replaceState(null, "", location.pathname);
  const iteration = Number(raw);
  if (!Number.isFinite(iteration) || iteration <= 0) return;
  arrivedFromNotification.value = true;
  const kind: NotificationKind = params.get("kind") === "lost_top"
    ? "lost_top"
    : "daily_final";
  navigateToNotification(iteration, kind);
};
