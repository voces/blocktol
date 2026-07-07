import { useEffect, useState } from "preact/compat";
import { api, MessageMap } from "../api.ts";

export type ProfileData = MessageMap["getProfile"];

// A tiny module-level cache so the profile dialog can open on already-loaded
// data instead of an empty shell. Prefetched once after the app loads
// (see App.tsx), warmed again on profile-button intent, and refetched when the
// dialog opens.
let cache: ProfileData | undefined;
let inFlight: Promise<ProfileData | undefined> | null = null;
let fetchedAt = 0;
const subscribers = new Set<(d: ProfileData) => void>();

// How long a fetched profile stays fresh. Prefetch triggers (hover/focus) and
// the dialog's open-time refetch fire well within this, so they read the cache
// instead of hitting the network — bounding requests to at most one per window.
const STALE_MS = 20_000;

const publish = (data: ProfileData) => {
  cache = data;
  for (const sub of subscribers) sub(data);
};

// Fetch the profile and populate the cache, but coalesce concurrent callers onto
// one request and skip entirely while the cache is still fresh — so however many
// times the button is hovered/focused, this fires at most once per STALE_MS.
// Errors are swallowed (the caller keeps showing whatever was cached).
export const fetchProfile = (): Promise<ProfileData | undefined> => {
  if (inFlight) return inFlight;
  if (cache && Date.now() - fetchedAt < STALE_MS) return Promise.resolve(cache);
  inFlight = api.getProfile({})
    .then((p) => {
      if (p && !("error" in p)) {
        fetchedAt = Date.now();
        publish(p);
        return p;
      }
      return cache;
    })
    .catch(() => cache)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
};

export const useProfile = () => {
  const [profile, setProfile] = useState<ProfileData | undefined>(cache);

  useEffect(() => {
    subscribers.add(setProfile);
    return () => {
      subscribers.delete(setProfile);
    };
  }, []);

  return { profile, refetch: fetchProfile, patch: publish };
};
