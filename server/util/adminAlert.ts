import { env } from "./env.ts";
import { errText, log } from "./logging.ts";
import process from "node:process";

// A fire-and-forget admin ping to Discord for rare, human-actionable events
// (e.g. a player hitting the attempts cap).
//
// A plain webhook POST of `{ content }`: no bot token, no discord.js. Never
// awaited, never throws, and a no-op without DISCORD_ADMIN_WEBHOOK_URL. The
// env prefix keeps a dev ping from being mistaken for prod.
const WEBHOOK = process.env.DISCORD_ADMIN_WEBHOOK_URL;

export const alertAdmin = (message: string): void => {
  if (!WEBHOOK) return;
  // Discord caps webhook content at 2000 chars.
  const content = `[blocktol:${env}] ${message}`.slice(0, 1900);
  fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Alerts quote player-controlled text; never let it ping anyone.
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    // Fire-and-forget still holds a socket open while Discord hangs.
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => {
      if (!r.ok) log.error("admin alert failed", { status: r.status });
    })
    .catch((err) => log.error("admin alert error", { error: errText(err) }));
};
