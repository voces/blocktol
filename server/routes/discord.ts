import { z } from "zod";
import { DISCORD_INVITE } from "../../common/constants.ts";
import { method } from "./apiHelpers.ts";

// Live "online now" count for the community Discord, read from the invite's
// approximate presence count. The invite endpoint needs no widget enabled and
// no bot token — just the (permanent) invite code — so there's nothing extra to
// configure server-side.
//
// Cached in-process for a minute: the figure is decorative and Discord rate
// limits this endpoint, so we never fetch it per profile-open. A failed refresh
// keeps the last known value (never a fake one) and still advances the clock, so
// an outage can't hammer Discord; the client hides the count when it's null.

const TTL = 60_000;
const ENDPOINT =
  `https://discord.com/api/v10/invites/${DISCORD_INVITE}?with_counts=true`;

let cache: { online: number | null; at: number } | null = null;

const fetchOnline = async (): Promise<number | null> => {
  try {
    const resp = await fetch(ENDPOINT);
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
