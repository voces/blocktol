import { h, render } from "preact";
import { prime, primeBoot } from "./api.ts";
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
// A `/YYYYMMDD` boot restores that day, not today (see store/notifNav.ts). The
// primed pool is keyed by method name only, so the day-link's own first
// getBoard / standings call would otherwise consume TODAY's primed response and
// stage today instead — so skip those two today-primes on a day-link boot and
// let the deep-link fetch the day for real.
const dayLinkBoot = /^\/\d{8}$/.test(location.pathname);
if (!getPendingLink() && !getCleanLink() && getHasCompletedOnboarding()) {
  if (dayLinkBoot) {
    // A day-link boot stages the LINKED day, not today, so it deliberately skips
    // priming today's board/standings (the deep link fetches the day for real).
    // Only the day-independent slices are worth priming here.
    prime("getDailySummary", { timeZone: getTimeZone() });
    prime("getProfile", {});
  } else {
    // Normal boot: one request feeds the whole thing. Each method boot bundles —
    // getDailySummary, getProfile, standings, getBoard (soft), getNotifications,
    // and the current month's list — consumes its slice off this single fetch,
    // collapsing the old two-wave fan-out. list is content-keyed by its month
    // range so only the current-month calendar fetch consumes it (the prev month
    // keys separately). (getBoard is soft, so an unfinished daily comes back
    // { incomplete }; showBoard discards that and fetches for real, so priming
    // can never wedge a later stage.)
    primeBoot(
      { timeZone: getTimeZone() },
      monthListInput(currentMonthIdx()),
    ).then((b) => {
      // Seed today's iteration id from boot BEFORE the board stages, so the
      // standings dock recognizes the staged board as today (isToday) and fetches
      // standings for today (undefined → { timeZone }) — consuming boot's primed
      // slice — rather than fetching by id and missing it. Runs in the same
      // microtask batch as the primed slices, ahead of App's consume→stage chain.
      const s = b?.standings;
      if (s && !("error" in s) && typeof s.iteration === "number") {
        todayIteration.value = s.iteration;
      }
    }).catch(() => {});
  }
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
