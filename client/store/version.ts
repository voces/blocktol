import { signal } from "@preact/signals";
import { SHA } from "../../common/version.ts";

// This client's own build SHA — baked into the bundle at build time by
// scripts/genVersion.ts (common/version.ts, the same constant the server stamps
// on responses). Sent on every API request (client/api.ts) and compared against
// the server's `x-blocktol-server-sha`.
export const CLIENT_SHA = SHA;

// True once the server reports a build newer than this bundle: the deploy that's
// now answering is ahead of the assets this tab is running, so it should reload
// to pick them up — but only at a safe moment, never mid-attempt (see
// useVersionRefresh). Sticky: once stale, always stale until the reload lands.
export const staleClient = signal(false);

// Fold in the server's build SHA from a response header. A mismatch means this
// tab is stale. Skipped when either side is "dev" (an unbuilt local checkout):
// `deno task dev` rebuilds the bundle without a git stamp, so comparing there is
// meaningless and would reload-loop. Null on synthetic/primed responses (no
// header) and legacy paths — a no-op.
export const noteServerVersion = (serverSha: string | null) => {
  if (!serverSha || serverSha === "dev" || CLIENT_SHA === "dev") return;
  if (serverSha !== CLIENT_SHA) staleClient.value = true;
};
