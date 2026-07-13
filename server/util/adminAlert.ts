import { env } from "./env.ts";
import { log } from "./logging.ts";

// A fire-and-forget admin ping to Discord for rare, human-actionable events an
// operator should see (e.g. a player hitting the attempts cap).
//
// Uses Discord's plain webhook REST endpoint — a webhook URL is the ONLY thing
// it needs: no bot token, no gateway connection, and deliberately no discord.js
// (the library is large and pulls in a gateway/websocket stack we don't want on
// an ephemeral isolate). Just a POST with a JSON `{ content }` body. Create the
// URL in the target channel's Settings → Integrations → Webhooks.
//
// Never awaited, never throws, and a no-op without DISCORD_ADMIN_WEBHOOK_URL —
// so local/dev and an unconfigured prod stay silent rather than erroring. The
// env prefix keeps a dev ping from being mistaken for prod.
//
// The read is guarded: db/user.ts imports this, and db/user.ts is imported by
// nearly everything (tests, the ops scripts), so a bare Deno.env.get would force
// every one of those entry points to add this var to its --allow-env or crash on
// import. Catching the permission error keeps it a silent no-op wherever the
// grant isn't present; only `start`/`dev` (which grant it) actually send.
const WEBHOOK = (() => {
  try {
    return Deno.env.get("DISCORD_ADMIN_WEBHOOK_URL");
  } catch {
    return undefined;
  }
})();

export const alertAdmin = (message: string): void => {
  if (!WEBHOOK) return;
  // Discord caps webhook content at 2000 chars; keep well under.
  const content = `[blocktol:${env}] ${message}`.slice(0, 1900);
  fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  })
    .then((r) => {
      if (!r.ok) log.error("admin alert failed", r.status);
    })
    .catch((err) => log.error("admin alert error", err));
};
