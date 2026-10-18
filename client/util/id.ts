import { storage } from "./storage.ts";

const getRandomValues = crypto.getRandomValues.bind(crypto) ??
  ((arr: number[]) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  });

// 64 bits of randomness encoded as a single base36 big integer (13 chars).
// Collisions stay negligible well past any realistic user count (birthday bound
// ~2^32). The id is also the bearer credential (see signInLink).
const ID_BYTES = 8;
const ID_LENGTH = 13;

const randomId = () => {
  let n = 0n;
  for (const byte of getRandomValues(new Uint8Array(ID_BYTES))) {
    n = (n << 8n) | BigInt(byte);
  }
  return n.toString(36).padStart(ID_LENGTH, "0");
};

// The sign-in link for an id, shown as a QR and copied by "move to device". The
// id rides the URL FRAGMENT (`/#l=<id>`), which a browser never sends. A path
// segment would reach nginx's access log and Deno's OTel span (`url.full` /
// `url.path`), which app code can't scrub, and the id is the whole bearer
// credential.
export const signInLink = (id: string) =>
  new URL("/#l=" + encodeURIComponent(id), location.origin).href;

// The id in the current URL if it is a sign-in link: `/#l=<id>` (see
// signInLink) or the legacy path forms `/login/<id>` and `/l/<id>`, still in
// old QRs and saved links. Null otherwise.
const linkIdFromPath = () => {
  if (location.hash.startsWith("#l=")) {
    try {
      return decodeURIComponent(location.hash.slice(3)) || null;
    } catch {
      return null;
    }
  }
  if (location.pathname.startsWith("/login/")) {
    return location.pathname.slice(7);
  }
  if (location.pathname.startsWith("/l/")) return location.pathname.slice(3);
  return null;
};

export const getId = () => {
  const link = linkIdFromPath();
  const storedId = storage.getItem("id");

  // A link is never adopted here. One matching the stored id is who we already
  // are; one differing from it is a fork that getPendingLink surfaces and the
  // move/merge gate resolves (adopt, merge, or ignore) before the app commits
  // an id.
  if (link && link === storedId) return link;
  if (storedId) return storedId;

  // No stored id: mint one. On a clean device with a link, the gate confirms
  // first (getCleanLink) and calls startFreshId / adoptId to override.
  const id = randomId();
  storage.setItem("id", id);
  return id;
};

// A sign-in link that landed on a device already holding a different id: the
// fork the move/merge gate resolves. Null on a clean device or when the link is
// who we already are.
export const getPendingLink = () => {
  const link = linkIdFromPath();
  const storedId = storage.getItem("id");
  return link && storedId && link !== storedId ? link : null;
};

// A link on a device with no stored id: the clean-adopt confirm, where the gate
// shows "Continue as <name>?" instead of signing in silently. Null when there
// is no link or the device already has an id.
export const getCleanLink = () => {
  const link = linkIdFromPath();
  return link && !storage.getItem("id") ? link : null;
};

// Commit a chosen id as this device's identity (adopting a link).
export const adoptId = (id: string) => storage.setItem("id", id);

// Start over as a brand-new profile ("not you? start a new game").
export const startFreshId = () => {
  const id = randomId();
  storage.setItem("id", id);
  return id;
};

// Drop the #l=<id> (or legacy /l/<id>, /login/<id>) from the URL so a refresh
// doesn't re-open the gate after a decision is made.
export const clearLinkFromUrl = () => {
  if (linkIdFromPath()) history.replaceState(null, "", "/");
};
