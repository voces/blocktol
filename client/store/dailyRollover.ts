import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { localDay, sameDay } from "../util/dayBoundary.ts";
import { fetchStandings } from "./standings.ts";
import { currentMonthIdx, refreshMonth } from "./dailyItems.ts";

// Daily rollover: ranked play belongs to the player's local day, so past local
// midnight a NEW daily becomes available. This store detects that and drives
// the switch; the board re-stage is a registered callback, as in the board
// store.

// The local day the ranked session is pinned to (boot, or the last switch).
let sessionDay: [number, number, number] | undefined;

// True once the local day has passed `sessionDay`. The notice is
// non-dismissible: it stays until the player switches, which re-pins and
// clears.
export const newDailyAvailable = signal(false);

// True while local midnight is cutting a ranked build's window short (the HUD
// says so).
export const rankedEndsAtMidnight = signal(false);

// Re-stage the new day's board (enterPrestart); wired by useInit, which has the
// game state. No-op until wired.
let restageNewDaily: () => void = () => {};
export const setNewDailyRestage = (fn: () => void) => {
  restageNewDaily = fn;
};

// Pin the session to the current local day and clear the pending notice.
export const pinSessionDay = () => {
  sessionDay = localDay();
  newDailyAvailable.value = false;
};

export const rolledOver = (): boolean =>
  sessionDay !== undefined && !sameDay(localDay(), sessionDay);

const check = () => {
  if (rolledOver()) newDailyAvailable.value = true;
};

// Switch to the new day: re-pin, re-stage its prestart, and refresh the
// day-scoped stores together, since piecemeal re-resolution desyncs at
// midnight. The summary corrects the attempt count, standings re-seeds
// todayIteration, and the month refresh surfaces the new day's calendar cell.
export const playNewDaily = () => {
  pinSessionDay();
  restageNewDaily();
  void api.getDailySummary({ timeZone: getTimeZone() });
  void fetchStandings();
  refreshMonth(currentMonthIdx());
};

// One watcher for the app's lifetime: a periodic check plus one on return to
// the foreground, since a backgrounded tab throttles the interval.
let started = false;
export const startRolloverWatch = () => {
  if (started) return;
  started = true;
  setInterval(check, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
};
