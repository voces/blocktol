import { useEffect } from "preact/compat";
import { BoardPhase } from "../components/Game/useGameState.ts";
import { staleClient } from "../store/version.ts";

// Reload the tab once the server reports a newer build than this bundle
// (store/version.ts) — but never mid-attempt. "building" (a run's window is
// counting down) and "running" (the runner is animating) are the middle of a
// ranked or free-play attempt; a reload there would abandon it, so the reload
// waits until the board settles into any other phase. The stale flag is sticky,
// so leaving the attempt re-runs this and reloads then. location.reload()
// re-fetches index.html + the bundle, which the deploy changed.
//
// Reading staleClient.value here (during the caller's render) subscribes the
// caller to the signal, so a mid-build flip re-renders and re-runs the effect
// with the new phase once the attempt ends.
export const useVersionRefresh = (phase: BoardPhase) => {
  const stale = staleClient.value;
  useEffect(() => {
    if (!stale) return;
    if (phase === "building" || phase === "running") return;
    globalThis.location.reload();
  }, [stale, phase]);
};
