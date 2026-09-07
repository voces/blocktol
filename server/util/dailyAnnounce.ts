// The Discord "daily final" post, sent once a day is rated (util/rateDailies.ts).
// Renders the winners of the ranked daily board — everyone tied for the top time
// — up to 10 by name; past 10 it states the count only. Gold for a sole winner,
// chartreuse for a shared top (a record), matching the in-app palette. One-shot:
// a rated day is frozen, so there's nothing to edit later. Never throws — a
// webhook hiccup must not disturb the rating sweep.
//
// The same sweep sends a SECOND, separate message: the day's FREE-PLAY records —
// whoever reached the winning time off the ranked board. Those builds used to
// reach the channel live, as "top PB" posts while the daily was still open, which
// handed everyone still holding attempts the shape of the ceiling; util/pbBoard.ts
// now holds that post until the day is rated and they surface here instead, after
// the field is frozen.
//
// They are a separate MESSAGE rather than an addendum inside the summary (or a
// second embed on the same post) so the two can be moderated independently: the
// free-play post carries its own message id, so deleting or editing it away leaves
// the daily's own result standing untouched. Each list caps at the same 10 names
// as the other, and separately — they are two posts, so there is no shared budget.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import {
  getDailyStandings,
  getIterationBests,
  getStandingsMeta,
} from "../db/standings.ts";
import {
  CHARTREUSE,
  dayUrl,
  GOLD,
  postResult,
  type ResultEmbed,
} from "./discordResults.ts";
import { errText, log } from "./logging.ts";

type Day = [number, number, number];

const round2 = (n: number) => Math.round(n * 100) / 100;

// At most this many names are listed in a post; beyond it the post states the
// count only (a big tie would otherwise blow past Discord's embed limits and read
// as a wall of names). Applies to the winners and to the free-play records alike —
// they are separate messages, so each simply gets its own ten.
const MAX_NAMES = 10;

// One player who reached the day's winning time without a ranked run at it.
export type FreePlayReach = { name: string; time: number };

// Players who reached (or bettered) the winning ranked time on a build that
// ISN'T on the ranked board — a free-play maze. No "was this free play?" flag is
// needed: `top` is the maximum of the ranked field, so anyone whose ranked best
// stood at it is already a winner, and every remaining player at or above it got
// there off the ranked board by construction. Ordered best-first, ties resolving
// to whoever reached it earliest — the same rule getDailyStandings and
// getIterationBests order by, so the post reads in the board's own order.
export const freePlayReaches = (
  bests: readonly {
    user: string;
    name: string | null;
    best: number;
    at: number;
  }[],
  winners: ReadonlySet<string>,
  top: number,
): FreePlayReach[] =>
  bests
    .filter((b) => !winners.has(b.user) && round2(b.best) >= top)
    .sort((a, b) => b.best - a.best || a.at - b.at)
    .map((b) => ({ name: b.name ?? "anonymous", time: round2(b.best) }));

export const dailyEmbed = (
  winners: string[],
  time: number,
  day: Day,
): ResultEmbed => {
  const url = dayUrl(day, "daily");
  const date = formatNotifDate(day);
  const t = `${formatSeconds(time)}s`;
  const solo = winners.length === 1;

  let description: string;
  if (solo) {
    description = `**${winners[0]}** won the daily at **${t}**.`;
  } else if (winners.length <= MAX_NAMES) {
    description = `${winners.length} players tied for the top at **${t}**:\n${
      winners.map((w) => `• ${w}`).join("\n")
    }`;
  } else {
    description = `${winners.length} players tied for the top at **${t}**.`;
  }
  description += `\n\n[View the results](${url})`;

  return {
    title: `Daily results: ${date}`,
    url,
    description,
    color: solo ? GOLD : CHARTREUSE,
  };
};

// The free-play companion post, or null when nobody reached the top off the
// ranked board — the caller then sends nothing, so a quiet day is still a single
// message in the channel. It restates the bar it is measured against (the post
// stands alone, and can outlive the summary if that one is moderated away) and
// links the day's BEST-BUILD board, not the ranked one these players missed.
//
// A reach that BETTERED the winning time carries its own time — the interesting
// case, the daily's winner not being the day's best build; an exact match is just
// a name, since that time is the one stated a line above. That same distinction
// picks the colour off the existing palette: bettering the daily's top is an
// outright day's-best build (GOLD), while a post of exact matches is a shared
// record (CHARTREUSE). Reaches arrive best-first, so the first one decides.
export const freePlayEmbed = (
  reaches: readonly FreePlayReach[],
  top: number,
  day: Day,
): ResultEmbed | null => {
  if (reaches.length === 0) return null;
  const url = dayUrl(day, "pb");
  const date = formatNotifDate(day);
  const t = `${formatSeconds(top)}s`;

  const description = reaches.length > MAX_NAMES
    ? `${reaches.length} players reached the daily's winning time of **${t}** in free play.`
    : `Reached the daily's winning time of **${t}** in free play:\n${
      reaches.map((r) =>
        r.time > top
          ? `• ${r.name} — **${formatSeconds(r.time)}s**`
          : `• ${r.name}`
      ).join("\n")
    }`;

  return {
    title: `Free play: ${date}`,
    url,
    description: `${description}\n\n[View the best builds](${url})`,
    color: reaches[0].time > top ? GOLD : CHARTREUSE,
  };
};

export const announceDailyResult = async (iteration: number) => {
  try {
    const [rows, bests, meta] = await Promise.all([
      getDailyStandings(iteration),
      getIterationBests(iteration),
      getStandingsMeta(iteration),
    ]);
    if (rows.length === 0) return; // no ranked field — nothing to announce
    const top = round2(rows[0].time);
    const winners = rows.filter((r) => round2(r.time) === top);
    const day: Day = [meta.y, meta.m, meta.d];

    await postResult(dailyEmbed(
      winners.map((r) => r.name ?? "anonymous"),
      top,
      day,
    ));

    // Sent after the summary, and awaited in turn rather than raced with it, so
    // the two land in the channel in that order. postResult never throws and
    // reports its own failures, so a dropped summary doesn't cost us this one —
    // the free-play post reads on its own.
    const free = freePlayEmbed(
      freePlayReaches(bests, new Set(winners.map((r) => r.user)), top),
      top,
      day,
    );
    if (free) await postResult(free);
  } catch (err) {
    log.error("announceDailyResult failed", {
      iteration,
      error: errText(err),
    });
  }
};
