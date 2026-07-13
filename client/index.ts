import { h, render } from "preact";
import { primeBoot } from "./api.ts";
import { currentMonthIdx, monthListInput } from "./store/dailyItems.ts";
import { todayIteration } from "./store/standings.ts";
import { App, getHasCompletedOnboarding } from "./components/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { initSettings } from "./hooks/useSettings.ts";
import { installErrorReporting } from "./util/errorReport.ts";
import { getCleanLink, getPendingLink } from "./util/id.ts";
import { getTimeZone } from "./util/timeZone.ts";

// Catch uncaught errors / rejections app-wide and forward them to NewRelic
// (via the reportClientError endpoint). Installed first so a crash during boot
// is still reported.
installErrorReporting();

// Apply the cached theme before first paint (the server value reconciles later).
initSettings();

// Head start on the boot round trips: fire them during module evaluation,
// before the first render; App's calls consume these primed responses (see
// api.prime). Skipped mid-onboarding (the app defers its fetch then anyway)
// and while a sign-in link is pending (the gate must resolve identity first —
// priming would bake in the wrong user).
//
// One request feeds the whole cold load. `boot` bundles getDailySummary,
// getProfile, standings, getBoard (soft), getNotifications, and the calendar's
// two mount months (current + prev); the client primes each slice, content-keyed
// by the input its consumer sends, so every call site consumes off this single
// fetch (getBoard is soft, so an unfinished daily comes back { incomplete };
// showBoard discards that and fetches for real, so priming can never wedge a
// later stage).
//
// A `/YYYYMMDD` permalink restores that day, not today (see store/notifNav.ts).
// It boots through the SAME request: `day` tells boot to also bundle the linked
// day's board + standings, and primeBoot primes the three calls the deep-link
// handler fires for it (by-date standings to resolve the id, then getBoard and
// standings by iteration). Because the pool is content-keyed (method + input),
// the linked day's iteration-keyed calls never collide with today's timeZone-
// keyed primes — so today's slices still feed the dock/calendar/summary while the
// linked day feeds the staged board. (This is why the old day-link path, which
// skipped boot entirely, is no longer needed.)
const dayMatch = location.pathname.match(/^\/(\d{4})(\d{2})(\d{2})$/);
if (!getPendingLink() && !getCleanLink() && getHasCompletedOnboarding()) {
  const idx = currentMonthIdx();
  const day: [number, number, number] | undefined = dayMatch
    ? [Number(dayMatch[1]), Number(dayMatch[2]), Number(dayMatch[3])]
    : undefined;
  primeBoot(
    { timeZone: getTimeZone(), ...(day ? { day } : {}) },
    [monthListInput(idx), monthListInput(idx - 1)],
  ).then((b) => {
    // Seed today's iteration id from boot BEFORE the board stages, so the
    // standings dock recognizes today (isToday) and consumes boot's { timeZone }
    // slice rather than fetching by id. On a day-link boot this also lets the dock
    // tell the linked day apart from today. Runs in the same microtask batch as
    // the primed slices, ahead of App's consume→stage chain.
    const s = b?.standings;
    if (s && !("error" in s) && typeof s.iteration === "number") {
      todayIteration.value = s.iteration;
    }
  }).catch(() => {});
}

render(h(ErrorBoundary, null, h(App, {})), document.body);

globalThis.addEventListener("contextmenu", (e) => e.preventDefault());

// Suppress iOS's selection magnifier (the loupe) that appears on tap-and-hold
// and double-tap over the board. Nothing on the page is selectable, but CSS
// user-select/touch-callout: none doesn't fully stop it on SVG, and the
// gameplay touchstart listener is registered passive so its preventDefault is
// ignored. Cancel the browser's default gesture for touches that land on the
// board SVG. Scoped to SVGs *inside the board frame* — not just any SVGElement:
// icon SVGs live inside buttons (calendar, profile, logo), and cancelling the
// touch default there also cancels the synthesized click, so onClick would
// never fire on touch. Our own touch listeners still run (this only cancels the
// browser default, not our handlers).
const suppressBoardGesture = (e: TouchEvent) => {
  if (e.target instanceof SVGElement && e.target.closest(".board-frame")) {
    e.preventDefault();
  }
};
for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
  globalThis.addEventListener(type, suppressBoardGesture, { passive: false });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

// Don't annoy users with an install banner...
globalThis.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
});

const onResize = () => {
  document.documentElement.style.setProperty(
    "--full-height",
    `${window.innerHeight}px`,
  );
};
globalThis.addEventListener("resize", onResize);
onResize();
