import { h, render } from "preact";
import { primeSession } from "./boot.ts";
import { App, getHasCompletedOnboarding } from "./components/App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { installFreePlayOutbox } from "./components/Game/freePlay.ts";
import { initSettings } from "./hooks/useSettings.ts";
import { installErrorReporting } from "./util/errorReport.ts";
import { getCleanLink, getPendingLink } from "./util/id.ts";

// Forward uncaught errors and rejections to the server (`reportClientError`).
// Installed first so a crash during boot is still reported.
installErrorReporting();

// Apply the cached theme before first paint (the server value reconciles
// later).
initSettings();

// Fire the boot round trips during module evaluation, before the first render;
// App's calls consume the primed responses (see primeSession / api.primeBoot).
// Skipped while a sign-in link is pending, since priming would bake in the
// wrong user, and mid-onboarding, since the tutorial outlasts a prime's
// lifetime (PRIME_TTL_MS); a first-time user primes on finishing (App's onDone
// calls primeSession).
if (!getPendingLink() && !getCleanLink() && getHasCompletedOnboarding()) {
  void primeSession();
}

render(h(ErrorBoundary, null, h(App, {})), document.body);

// Re-send free-play commits an earlier session couldn't land (commit outbox in
// Game/freePlay.ts), after boot and whenever we're back online.
installFreePlayOutbox();

globalThis.addEventListener("contextmenu", (e) => e.preventDefault());

// Suppress iOS's selection magnifier (the loupe) on tap-and-hold and double-tap
// over the board. CSS user-select/touch-callout: none doesn't fully stop it on
// SVG, and the gameplay touchstart listener is passive, so its preventDefault
// is ignored. Scoped to SVGs inside the board frame, not any SVGElement: icon
// SVGs live inside buttons, and cancelling the touch default there also cancels
// the synthesized click, so onClick would never fire. Our own touch listeners
// still run.
const suppressBoardGesture = (e: TouchEvent) => {
  if (e.target instanceof SVGElement && e.target.closest(".board-frame")) {
    e.preventDefault();
  }
};
for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
  globalThis.addEventListener(type, suppressBoardGesture, { passive: false });
}

if ("serviceWorker" in navigator) {
  // Registration rejects where the browser blocks service workers (site data
  // disabled, some private modes, enterprise policy). That's benign: identity
  // is localStorage, so the app only loses PWA install, offline shell and push.
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
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
