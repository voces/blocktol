import { h, render } from "preact";
import { App } from "./components/App.tsx";

render(h(App, {}), document.body);

globalThis.addEventListener("contextmenu", (e) => e.preventDefault());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" });
}
