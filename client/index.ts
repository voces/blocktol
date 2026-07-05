import { h, render } from "preact";
import { App } from "./components/App.tsx";

render(h(App, {}), document.body);

globalThis.addEventListener("contextmenu", (e) => e.preventDefault());

// Suppress iOS's selection magnifier (the loupe) that appears on tap-and-hold
// and double-tap over the board. Nothing on the page is selectable, but CSS
// user-select/touch-callout: none doesn't fully stop it on SVG, and the
// gameplay touchstart listener is registered passive so its preventDefault is
// ignored. Cancel the browser's default gesture for touches that land on the
// board SVG. Scoped to SVG targets so page scrolling, buttons and single taps
// are unaffected; our own touch listeners still run (this only cancels the
// browser default, not our handlers).
const suppressBoardGesture = (e: TouchEvent) => {
  if (e.target instanceof SVGElement) e.preventDefault();
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
