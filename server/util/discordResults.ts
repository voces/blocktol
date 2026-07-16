import { env } from "./env.ts";
import { errText, log } from "./logging.ts";

// The results webhook: player-facing "top PB" and "daily final" posts, distinct
// from adminAlert's operator pings. Same plain-REST approach (a webhook URL is
// the only thing needed — no bot token, no discord.js; see adminAlert.ts for the
// rationale), but these send rich embeds (title link + colour) and, for the PB
// post, need the created message id back so a later tie can edit it.
//
// Reads DISCORD_RESULTS_WEBHOOK_URL, falling back to DISCORD_ADMIN_WEBHOOK_URL so
// results land in the existing channel until a dedicated one is wired up (just
// set the new var to split them out — no code change). The env read is guarded
// exactly like adminAlert's: these modules are pulled in transitively by the run
// routes and the rating cron, so a bare Deno.env.get would force every importer
// (tests, ops scripts) to grant the var or crash on import — catching the
// permission error keeps it a silent no-op wherever the grant isn't present.
const WEBHOOK = (() => {
  try {
    return Deno.env.get("DISCORD_RESULTS_WEBHOOK_URL") ??
      Deno.env.get("DISCORD_ADMIN_WEBHOOK_URL");
  } catch {
    return undefined;
  }
})();

// The game's result palette (common/percentileColor.ts) as Discord embed ints:
// GOLD is SUPREME_COLOR (#f0c442, an outright #1) and CHARTREUSE is PEAK_COLOR
// (#9ed54a, a shared/tied top — "a record"). Keeping the two in sync with the
// in-app colours is the point of reusing the same hexes.
export const GOLD = 0xf0c442;
export const CHARTREUSE = 0x9ed54a;

// Absolute site origin for the day permalink (a Discord link can't be relative,
// unlike the in-app push URLs). The webhook is env-tagged in the footer, so a
// dev post linking to prod is unambiguous.
const SITE = "https://blocktol.com";
const pad = (n: number) => String(n).padStart(2, "0");

// The `/YYYYMMDD?board=` deep link, matching the push notifier's permalink shape
// (store/notifNav.ts): `pb` selects the best-build board, `daily` the ranked one.
export const dayUrl = (
  [y, m, d]: readonly [number, number, number],
  board: "pb" | "daily",
): string => `${SITE}/${y}${pad(m)}${pad(d)}?board=${board}`;

export type ResultEmbed = {
  title: string;
  url: string;
  description: string;
  color: number;
};

// Tag non-prod posts so a dev/local run is distinguishable in a shared channel;
// prod (the real results channel) stays clean. allowed_mentions none is belt-and-
// braces: embeds already never trigger @mentions, so a player display name that
// contains "@everyone" can't ping — but we send no content and disable mentions
// outright regardless.
const body = (embed: ResultEmbed) =>
  JSON.stringify({
    embeds: [{
      ...embed,
      ...(env === "prod" ? {} : { footer: { text: `blocktol:${env}` } }),
    }],
    allowed_mentions: { parse: [] },
  });

const HEADERS = { "content-type": "application/json" };

// Post a result embed. Uses `?wait=true` so Discord returns the created message
// object; its id lets a later tie PATCH this same post. Never throws — a webhook
// hiccup must not fail the run/cron that called it — and a no-op (null) without a
// configured webhook. Returns the message id, or null on any failure.
export const postResult = async (
  embed: ResultEmbed,
): Promise<string | null> => {
  if (!WEBHOOK) return null;
  try {
    const url = new URL(WEBHOOK);
    url.searchParams.set("wait", "true");
    const res = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: body(embed),
    });
    if (!res.ok) {
      log.error("result post failed", { status: res.status });
      return null;
    }
    const json = await res.json();
    return typeof json?.id === "string" ? json.id : null;
  } catch (err) {
    log.error("result post error", { error: errText(err) });
    return null;
  }
};

// Edit a previously-posted result (the PB tie update). Best-effort, never throws.
export const editResult = async (
  messageId: string,
  embed: ResultEmbed,
): Promise<void> => {
  if (!WEBHOOK) return;
  try {
    const res = await fetch(`${WEBHOOK}/messages/${messageId}`, {
      method: "PATCH",
      headers: HEADERS,
      body: body(embed),
    });
    if (!res.ok) log.error("result edit failed", { status: res.status });
  } catch (err) {
    log.error("result edit error", { error: errText(err) });
  }
};
