import { signal } from "@preact/signals";
import { api } from "../api.ts";
import { keyedQuery } from "./query.ts";

const KEY = "blocktol.discordOnline";

// Seed the "N online" figure from the last value we stored, so the Community
// card renders it immediately on open instead of growing a line once the live
// count lands. null means "no value yet" — the card reserves the row's space
// and shows a muted placeholder until the first fetch resolves.
const stored = (): number | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

// Warmed on profile-button intent (hover/focus) and refreshed on open, so the
// count is usually present before the dialog renders; components reading
// `discordOnline.value` re-render when it updates.
export const discordOnline = signal<number | null>(stored());

// At most one request per freshness window however many times intent fires; a
// failed fetch frees the window so the next intent retries. A null server
// result (its own lookup failed) is left to fall through without clobbering the
// last-known value on screen.
const fetchOnce = keyedQuery(async () => {
  const r = await api.discordInfo({});
  if (!r || "error" in r) throw new Error("failed to fetch discord info");
  if (r.online != null) {
    discordOnline.value = r.online;
    try {
      localStorage.setItem(KEY, String(r.online));
    } catch { /* private mode / disabled storage */ }
  }
  return r.online;
}, { staleMs: 30_000 });

// Fetch (or serve the fresh cache). Errors are swallowed — the card keeps
// showing whatever was last known.
export const fetchDiscordOnline = (): Promise<number | null> =>
  fetchOnce(undefined).catch(() => discordOnline.peek());
