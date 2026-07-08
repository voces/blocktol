import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { keyedQuery } from "./query.ts";

export type ProfileData = MessageMap["getProfile"];

// The signed-in user's profile stats. Warmed on boot and on profile-button
// intent (hover/focus), so the dialog opens on data instead of an empty
// shell; components reading `profile.value` re-render when it lands.
export const profile = signal<ProfileData | undefined>(undefined);

// However many times intent fires, at most one request per freshness window;
// a failed fetch frees the window so the next intent retries.
const fetchOnce = keyedQuery(async () => {
  const p = await api.getProfile({});
  if (!p || "error" in p) throw new Error("failed to fetch profile");
  profile.value = p;
  return p;
}, { staleMs: 20_000 });

// Fetch (or serve the fresh cache). Errors are swallowed — callers keep
// showing whatever was cached.
export const fetchProfile = (): Promise<ProfileData | undefined> =>
  fetchOnce(undefined).catch(() => profile.peek());

// Apply a locally-known change (e.g. a rename's response) without a refetch.
export const patchProfile = (p: ProfileData) => {
  profile.value = p;
};
