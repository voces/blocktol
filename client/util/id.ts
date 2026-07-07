const getRandomValues = crypto.getRandomValues.bind(crypto) ??
  ((arr: number[]) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  });

// 64 bits of randomness encoded as a single base36 big integer (13 chars). The
// id isn't a real secret — it just rides the authorization header for
// convenience — so only collision resistance matters, and 64 bits stays
// collision-free well past any realistic user count (birthday bound ~2^32).
// (The old scheme was 32 chars: two base36 chars per byte, where each pair used
// only 256 of its 1296 values — ~23% wasted even before the entropy drop.)
const ID_BYTES = 8;
const ID_LENGTH = 13;

const randomId = () => {
  let n = 0n;
  for (const byte of getRandomValues(new Uint8Array(ID_BYTES))) {
    n = (n << 8n) | BigInt(byte);
  }
  return n.toString(36).padStart(ID_LENGTH, "0");
};

// The id embedded in a sign-in link, if the current URL is one: `/login/<id>`
// (long) and `/l/<id>` (the move-to-device short alias). Null otherwise.
const linkIdFromPath = () => {
  if (location.pathname.startsWith("/login/")) {
    return location.pathname.slice(7);
  }
  if (location.pathname.startsWith("/l/")) return location.pathname.slice(3);
  return null;
};

export const getId = () => {
  const link = linkIdFromPath();
  const storedId = localStorage.getItem("id");

  // A link only auto-adopts on a device that has no id yet handled by the gate,
  // or when it's simply who we already are — never over a *different* existing
  // profile. That case is a fork: getPendingLink surfaces it and the move/merge
  // gate resolves it (adopt, merge, or ignore) before the app commits an id.
  if (link && link === storedId) return link;
  if (storedId) return storedId;

  // No stored id and no link (or a link on a clean device, which the gate
  // confirms first): mint one. The gate calls startFreshId / adoptId to override.
  const id = randomId();
  localStorage.setItem("id", id);
  return id;
};

// A sign-in link that landed on a device already holding a *different*, non-empty
// profile — the fork the move/merge gate resolves. Null on a clean device (no
// stored id) or when the link is who we already are; those don't fork.
export const getPendingLink = () => {
  const link = linkIdFromPath();
  const storedId = localStorage.getItem("id");
  return link && storedId && link !== storedId ? link : null;
};

// A link on a device with no stored id yet — the clean-adopt confirm (1d). The
// gate shows "Continue as <name>?" rather than silently signing in. Null when
// there's no link or the device already has an id (that path forks or is normal).
export const getCleanLink = () => {
  const link = linkIdFromPath();
  return link && !localStorage.getItem("id") ? link : null;
};

// Commit a chosen id as this device's identity — adopting a link (switch/merge
// into the link) or confirming a clean adopt.
export const adoptId = (id: string) => localStorage.setItem("id", id);

// Start over as a brand-new profile (1d's "not you? start a new game").
export const startFreshId = () => {
  const id = randomId();
  localStorage.setItem("id", id);
  return id;
};

// Drop the /l/<id> (or /login/<id>) from the URL so a refresh doesn't re-open the
// gate after a decision is made.
export const clearLinkFromUrl = () => {
  if (linkIdFromPath()) history.replaceState(null, "", "/");
};
