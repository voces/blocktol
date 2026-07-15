import { h, render } from "preact";
import { primeSession } from "./boot.ts";
import { App, getHasCompletedOnboarding } from "./components/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { initSettings } from "./hooks/useSettings.ts";
import { installErrorReporting } from "./util/errorReport.ts";
import { getCleanLink, getPendingLink } from "./util/id.ts";

// Catch uncaught errors / rejections app-wide and forward them to the server
// (via the reportClientError endpoint → VictoriaLogs). Installed first so a
// crash during boot is still reported.
installErrorReporting();

// Apply the cached theme before first paint (the server value reconciles later).
initSettings();

// Head start on the boot round trips: fire them during module evaluation,
// before the first render; App's calls consume these primed responses (see
// api.prime). Skipped mid-onboarding (the app defers its fetch then anyway)
// and while a sign-in link is pending (the gate must resolve identity first —
// priming would bake in the wrong user).
//
// One request feeds the whole cold load (see primeSession / api.primeBoot): boot
// bundles getDailySummary, getProfile, standings, getBoard (soft),
// getNotifications, and the calendar's two mount months, and — on a `/YYYYMMDD`
// permalink — that day's linked board + standings too. The client primes each
// slice content-keyed by the input its consumer sends, so every call site
// consumes off this single fetch.
//
// Skipped mid-onboarding: boot auto-starts the daily's ranked attempt (opening
// the 60s clock), which must not happen during the tutorial — so a first-time
// user primes instead the moment they finish (App's onDone → primeSession),
// exactly when the app would auto-start the daily anyway. So this runs only for
// an already-onboarded user.
if (!getPendingLink() && !getCleanLink() && getHasCompletedOnboarding()) {
  primeSession();
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
