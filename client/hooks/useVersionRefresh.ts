import { useEffect } from "preact/compat";
import { type BoardPhase } from "../components/Game/useGameState.ts";
import { claimReloadFor, staleServerSha } from "../store/version.ts";

// Reload the tab once the server reports a different build than this bundle
// (store/version.ts), but never mid-attempt: "building" and "running" are the
// middle of a ranked or free-play attempt, and a reload would abandon it. The
// stale flag is sticky, so leaving the attempt re-runs this and reloads then.
//
// At most ONE automatic reload per server build (claimReloadFor). If the reload
// returns to the same mismatch (mid-deploy, or a cached bundle that doesn't
// match the shell), reloading again can't help and would loop. The tab carries
// on and the next visit or server build picks the update up.
//
// Reading staleServerSha.value during the caller's render subscribes it to the
// signal, so a mid-build flip re-runs the effect once the attempt ends.
export const useVersionRefresh = (phase: BoardPhase) => {
  const serverSha = staleServerSha.value;
  useEffect(() => {
    if (!serverSha) return;
    if (phase === "building" || phase === "running") return;
    if (claimReloadFor(serverSha)) globalThis.location.reload();
  }, [serverSha, phase]);
};
