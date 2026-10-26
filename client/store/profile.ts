import { signal } from "@preact/signals";
import { api, type MessageMap } from "../api.ts";
import { keyedQuery } from "./query.ts";

export type ProfileData = MessageMap["getProfile"];

// The user's profile stats. Warmed on boot and on profile-button intent
// (hover/focus), so the dialog opens on data.
export const profile = signal<ProfileData | undefined>(undefined);

// At most one request per freshness window; a failed fetch frees the window.
const fetchOnce = keyedQuery(async () => {
  const p = await api.getProfile({});
  if ("error" in p) throw new Error("failed to fetch profile");
  profile.value = p;
  return p;
}, { staleMs: 20_000 });

// Fetch, or serve the fresh cache. Errors are swallowed; callers keep what they
// have.
export const fetchProfile = (): Promise<ProfileData | undefined> =>
  fetchOnce(undefined).catch(() => profile.peek());

// Apply a known change (e.g. a rename's response) without a refetch.
export const patchProfile = (p: ProfileData) => {
  profile.value = p;
};
