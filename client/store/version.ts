import { signal } from "@preact/signals";
import { SHA } from "../../common/version.ts";
import { storage, storagePersistent } from "../util/storage.ts";

// This client's own build SHA — baked into the bundle at build time by
// scripts/genVersion.ts (common/version.ts, the same constant the server stamps
// on responses). Sent on every API request (client/api.ts) and compared against
// the server's `x-blocktol-server-sha`.
export const CLIENT_SHA = SHA;

// Set once the server reports a build other than this bundle's — normally a
// deploy that's now answering ahead of the assets this tab is running, so it
// should reload to pick them up, but only at a safe moment, never mid-attempt
// (see useVersionRefresh). Sticky: once stale, stale until the reload lands.
// Holds that server build (the latest such), which the once-per-build reload
// guard keys on.
export const staleServerSha = signal<string | null>(null);

// Fold in the server's build SHA from a response header. A mismatch means this
// tab is stale. Skipped when either side is "dev" (an unbuilt local checkout):
// `deno task dev` rebuilds the bundle without a git stamp, so comparing there is
// meaningless and would reload-loop. Null on synthetic/primed responses (no
// header) and legacy paths — a no-op.
//
// A mismatch is not always "the server is ahead": mid-deploy the outgoing
// process can still be answering a client that already loaded the NEW bundle,
// and no reload fixes that until the new process takes over. Hence the reload
// guard in useVersionRefresh rather than any ordering guess here.
export const noteServerVersion = (serverSha: string | null) => {
  if (!serverSha || serverSha === "dev" || CLIENT_SHA === "dev") return;
  if (serverSha !== CLIENT_SHA) staleServerSha.value = serverSha;
};

const RELOAD_KEY = "blocktol.reloadedFor";

// Claim the one automatic reload allowed for `serverSha`: true at most once per
// server build, so a reload that lands on the same mismatch (the case above)
// stops there instead of looping. The marker lives in the guarded storage
// wrapper; where site data is blocked it can't survive the reload it guards,
// so there we never auto-reload at all — the next visit picks the build up.
export const claimReloadFor = (serverSha: string) => {
  if (!storagePersistent) return false;
  if (storage.getItem(RELOAD_KEY) === serverSha) return false;
  storage.setItem(RELOAD_KEY, serverSha);
  return true;
};
