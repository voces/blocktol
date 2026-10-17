import { useEffect } from "preact/compat";
import { BoardPhase } from "../components/Game/useGameState.ts";
import { claimReloadFor, staleServerSha } from "../store/version.ts";

// Reload the tab once the server reports a different build than this bundle
// (store/version.ts) — but never mid-attempt. "building" (a run's window is
// counting down) and "running" (the runner is animating) are the middle of a
// ranked or free-play attempt; a reload there would abandon it, so the reload
// waits until the board settles into any other phase. The stale flag is sticky,
// so leaving the attempt re-runs this and reloads then. location.reload()
// re-fetches index.html + the bundle, which the deploy changed.
//
// At most ONE automatic reload per server build (claimReloadFor). If the reload
// comes back to the same mismatch — mid-deploy, the outgoing process answering
// a client that already has the new bundle, or a cached bundle that doesn't
// match the shell — reloading again can't help, and without the guard it
// looped as fast as the page could boot. The tab then carries on as it is and
// the next visit (or the next server build) picks the update up.
//
// Reading staleServerSha.value here (during the caller's render) subscribes the
// caller to the signal, so a mid-build flip re-renders and re-runs the effect
// with the new phase once the attempt ends.
export const useVersionRefresh = (phase: BoardPhase) => {
  const serverSha = staleServerSha.value;
  useEffect(() => {
    if (!serverSha) return;
    if (phase === "building" || phase === "running") return;
    if (claimReloadFor(serverSha)) globalThis.location.reload();
  }, [serverSha, phase]);
};
