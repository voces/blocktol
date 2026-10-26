import { env } from "./env.ts";
import { errText, log } from "./logging.ts";
import process from "node:process";

// The results webhook: player-facing "top PB" and "daily final" posts, distinct
// from adminAlert's operator pings. Same plain webhook REST (see
// adminAlert.ts), but these send rich embeds and need the created message id
// back so a later tie can edit the post.
//
// Reads DISCORD_RESULTS_WEBHOOK_URL, falling back to DISCORD_ADMIN_WEBHOOK_URL.
// The env read is guarded as in adminAlert.ts: the run routes and rating cron
// import this transitively, and under Deno a bare read would crash tests and
// ops scripts that lack the grant.
const WEBHOOK = (() => {
  try {
    return process.env.DISCORD_RESULTS_WEBHOOK_URL ??
      process.env.DISCORD_ADMIN_WEBHOOK_URL;
  } catch {
    return undefined;
  }
})();

// The game's result palette (common/percentileColor.ts) as Discord embed ints.
// GOLD is SUPREME_COLOR (an outright #1), CHARTREUSE is PEAK_COLOR (a shared
// top). Keep them in sync with the in-app hexes.
export const GOLD = 0xf0c442;
export const CHARTREUSE = 0x9ed54a;
// Recolours a SUPERSEDED top-PB message so only the current record is lit
// (Discord's "greyple").
export const GREY = 0x99aab5;

// Absolute origin for the day permalink (a Discord link can't be relative).
// Non-prod posts are footer-tagged, so a dev post linking to prod is clear.
const SITE = "https://blocktol.com";
const pad = (n: number) => String(n).padStart(2, "0");

// The `/YYYYMMDD?board=` deep link, the shape the push notifier uses
// (store/notifNav.ts): `pb` is the best-build board, `daily` the ranked one.
export const dayUrl = (
  [y, m, d]: readonly [number, number, number],
  board: "pb" | "daily",
): string => `${SITE}/${y}${pad(m)}${pad(d)}?board=${board}`;

// At most this many names are listed in a post; beyond it only the count (a big
// tie would blow past Discord's embed limits). Shared by the daily's winners
// and a record post's matchers.
export const MAX_NAMES = 10;

export type ResultEmbed = {
  title: string;
  url: string;
  description: string;
  color: number;
};

// Non-prod posts get a footer tag; prod stays clean. `allowed_mentions` none is
// belt-and-braces: embeds don't ping, but a display name containing "@everyone"
// must never be able to.
const body = (embed: ResultEmbed) =>
  JSON.stringify({
    embeds: [{
      ...embed,
      ...(env === "prod" ? {} : { footer: { text: `blocktol:${env}` } }),
    }],
    allowed_mentions: { parse: [] },
  });

const HEADERS = { "content-type": "application/json" };

// Bounds every call: posts run inside a player's save (onPbBuild) or the
// rate-dailies cron, so a hung socket would hang the save or stall rating. The
// timeout covers the body read too.
const TIMEOUT_MS = 10_000;

// Post a result embed. `?wait=true` makes Discord return the message, whose id
// lets util/pbBoard.ts edit the post later. Returns the id, or null on any
// failure or without a webhook. Never throws: a webhook failure must not fail
// the run or cron that called it.
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

// Edit a previously posted result. Best-effort, never throws. "ok" means the
// edit landed (callers advance their marker only then); "gone" means Discord no
// longer has the message (a moderator deleted it), so retrying is pointless;
// "failed" is anything else, worth retrying on the next build.
export const editResult = async (
  messageId: string,
  embed: ResultEmbed,
): Promise<"ok" | "gone" | "failed"> => {
  if (!WEBHOOK) return "failed";
  try {
    const res = await fetch(`${WEBHOOK}/messages/${messageId}`, {
      method: "PATCH",
      headers: HEADERS,
      body: body(embed),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      await res.body?.cancel();
      log.info("result edit: message gone", { messageId });
      return "gone";
    }
    if (!res.ok) {
      log.error("result edit failed", { status: res.status });
      return "failed";
    }
    return "ok";
  } catch (err) {
    log.error("result edit error", { error: errText(err) });
    return "failed";
  }
};
