import { signal } from "@preact/signals";
import { SHA } from "../../common/version.ts";
import { storage, storagePersistent } from "../util/storage.ts";

// This bundle's build SHA, baked in at build time by scripts/genVersion.ts
// (common/version.ts, the constant the server also stamps on responses). Sent
// on every API request and compared against the server's
// `x-blocktol-server-sha`.
export const CLIENT_SHA = SHA;

// Set once the server reports a build other than this bundle's, normally a
// deploy answering ahead of this tab's assets. Reload only at a safe moment,
// never mid-attempt (see useVersionRefresh). Sticky until the reload lands.
// Holds the latest such server build, which the once-per-build reload guard
// keys on.
export const staleServerSha = signal<string | null>(null);

// Fold in the server's build SHA from a response header; a mismatch marks this
// tab stale. Skipped when either side is "dev" (`deno task dev` rebuilds
// without a git stamp, so comparing would reload-loop). Null on
// synthetic/primed responses (no header) is a no-op.
//
// A mismatch doesn't mean the server is ahead: mid-deploy the outgoing process
// can still answer a client that loaded the NEW bundle, and no reload fixes
// that until the new process takes over. Hence the reload guard in
// useVersionRefresh rather than an ordering guess here.
export const noteServerVersion = (serverSha: string | null) => {
  if (!serverSha || serverSha === "dev" || CLIENT_SHA === "dev") return;
  if (serverSha !== CLIENT_SHA) staleServerSha.value = serverSha;
};

const RELOAD_KEY = "blocktol.reloadedFor";

// Claim the one automatic reload allowed for `serverSha`: true at most once per
// server build, so a reload landing on the same mismatch stops instead of
// looping. Where site data is blocked the marker can't survive the reload, so
// there we never auto-reload; the next visit picks the build up.
export const claimReloadFor = (serverSha: string) => {
  if (!storagePersistent) return false;
  if (storage.getItem(RELOAD_KEY) === serverSha) return false;
  storage.setItem(RELOAD_KEY, serverSha);
  return true;
};
