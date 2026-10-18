import { z } from "zod";
import { DISCORD_INVITE } from "../../common/constants.ts";
import { method } from "./apiHelpers.ts";

// "Online now" count for the community Discord, from the invite's approximate
// presence count (needs only the invite code, no widget or bot token).
//
// Cached in-process for a minute: Discord rate-limits this endpoint. A failed
// refresh keeps the last known value and still advances the clock, so an outage
// can't hammer Discord. The client hides the count when it's null.

const TTL = 60_000;
const ENDPOINT =
  `https://discord.com/api/v10/invites/${DISCORD_INVITE}?with_counts=true`;

let cache: { online: number | null; at: number } | null = null;

const fetchOnline = async (): Promise<number | null> => {
  try {
    // The profile awaits this, so a hung Discord must not hang it; a timeout
    // counts as any other failure.
    const resp = await fetch(ENDPOINT, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const n = data?.approximate_presence_count;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
};

export const discordInfo = method(z.object({}).optional())(async () => {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return { online: cache.online };
  const online = await fetchOnline();
  cache = { online: online ?? cache?.online ?? null, at: now };
  return { online: cache.online };
});
