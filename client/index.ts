import { h, render } from "preact";
import { prime } from "./api.ts";
import { App, getHasCompletedOnboarding } from "./components/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { initSettings } from "./hooks/useSettings.ts";
import { getCleanLink, getPendingLink } from "./util/id.ts";
import { getTimeZone } from "./util/timeZone.ts";

// Apply the cached theme before first paint (the server value reconciles later).
initSettings();

// Head start on the boot round trips: fire them during module evaluation,
// before the first render; App's calls consume these primed responses (see
// api.prime). Skipped mid-onboarding (the app defers its fetch then anyway)
// and while a sign-in link is pending (the gate must resolve identity first —
// priming would bake in the wrong user).
if (!getPendingLink() && !getCleanLink() && getHasCompletedOnboarding()) {
  prime("getDailySummary", { timeZone: getTimeZone() });
  prime("getProfile", {});
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
