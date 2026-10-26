import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { keyedQuery } from "./query.ts";
import { storage } from "../util/storage.ts";

const KEY = "blocktol.discordOnline";

// Seed the "N online" figure from the last stored value so the Community card
// renders it on open. null means no value yet: the card reserves the row and
// shows a placeholder until the first fetch resolves.
const stored = (): number | null => {
  try {
    const raw = storage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

// Warmed on profile-button intent (hover/focus) and refreshed on open.
export const discordOnline = signal<number | null>(stored());

// At most one request per freshness window; a failed fetch frees the window. A
// null `online` (the server's own lookup failed) doesn't clobber the last-known
// value.
const fetchOnce = keyedQuery(async () => {
  const r = await api.discordInfo({});
  if ("error" in r) throw new Error("failed to fetch discord info");
  if (r.online != null) {
    discordOnline.value = r.online;
    try {
      storage.setItem(KEY, String(r.online));
    } catch { /* private mode / disabled storage */ }
  }
  return r.online;
}, { staleMs: 30_000 });

// Fetch, or serve the fresh cache. Errors are swallowed; the card keeps the
// last-known value.
export const fetchDiscordOnline = (): Promise<number | null> =>
  fetchOnce(undefined).catch(() => discordOnline.peek());
