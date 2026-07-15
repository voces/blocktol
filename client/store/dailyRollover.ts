import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { localDay, sameDay } from "../util/dayBoundary.ts";
import { fetchStandings } from "./standings.ts";
import { currentMonthIdx, refreshMonth } from "./dailyItems.ts";

// Daily rollover: ranked play belongs to the player's local day, so when the
// clock ticks past local midnight a NEW daily becomes available. This store
// detects that tick and drives the switch — the actual board re-stage is a
// registered game-state callback (enterPrestart lives behind the context), the
// same handler pattern the board store uses.

// The local day the active ranked session was pinned to (boot, or the last
// switch). undefined until the first pin.
let sessionDay: [number, number, number] | undefined;

// True once the local day has ticked past `sessionDay` — a new daily is ready.
// Persists (the notice is deliberately non-dismissible) until the player
// switches to the new day, which re-pins and clears it.
export const newDailyAvailable = signal(false);

// Set true while a ranked build's window is being cut short by local midnight,
// so the HUD can say so. Cleared when no ranked build is midnight-limited.
export const rankedEndsAtMidnight = signal(false);

// Re-stage the new day's board (enterPrestart) — wired by useInit, since it
// needs game state. No-op until wired.
let restageNewDaily: () => void = () => {};
export const setNewDailyRestage = (fn: () => void) => {
  restageNewDaily = fn;
};

// Pin the session to the current local day (clears the pending notice).
export const pinSessionDay = () => {
  sessionDay = localDay();
  newDailyAvailable.value = false;
};

// Has the local day rolled past the pinned session day?
export const rolledOver = (): boolean =>
  sessionDay !== undefined && !sameDay(localDay(), sessionDay);

const check = () => {
  if (rolledOver()) newDailyAvailable.value = true;
};

// Switch to the new day: re-pin, re-stage its fresh prestart, and refresh the
// day-scoped stores so "today" moves as one coordinated step (rather than the
// piecemeal re-resolution that used to desync at midnight). The summary keeps
// the attempt count honest; standings re-seeds todayIteration; the month
// refresh surfaces the new day's calendar cell.
export const playNewDaily = () => {
  pinSessionDay();
  restageNewDaily();
  api.getDailySummary({ timeZone: getTimeZone() });
  fetchStandings();
  refreshMonth(currentMonthIdx());
};

// One watcher for the app's lifetime: a periodic check plus an immediate one on
// return to the foreground (a backgrounded tab throttles the interval, so a
// device left overnight catches the rollover the moment it's reopened).
let started = false;
export const startRolloverWatch = () => {
  if (started) return;
  started = true;
  setInterval(check, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
};
