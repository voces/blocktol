import { useEffect, useState } from "preact/compat";
import { api, MessageMap } from "../api.ts";

export type ProfileData = MessageMap["getProfile"];

// A tiny module-level cache so the profile dialog can open on already-loaded
// data instead of an empty shell. Prefetched once after the app loads
// (see App.tsx) and refetched whenever the dialog opens.
let cache: ProfileData | undefined;
const subscribers = new Set<(d: ProfileData) => void>();

const publish = (data: ProfileData) => {
  cache = data;
  for (const sub of subscribers) sub(data);
};

// Fetch the profile and populate the cache; ignores request errors (the caller
// keeps showing whatever was cached).
export const fetchProfile = () =>
  api.getProfile({}).then((p) => {
    if (p && !("error" in p)) publish(p);
    return p;
  }).catch(() => {});

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
