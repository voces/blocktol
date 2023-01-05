import { h, render } from "preact";
import { App } from "./components/App.tsx";

render(h(App, {}), document.body);

globalThis.addEventListener("contextmenu", (e) => e.preventDefault());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

// Don't annoy users with an install banner...
globalThis.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
});
