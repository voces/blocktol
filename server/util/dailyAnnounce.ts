// The Discord "daily final" post, sent once a day is rated (util/rateDailies.ts).
// Renders the winners of the ranked daily board — everyone tied for the top time
// — up to 10 by name; past 10 it states the count only. Gold for a sole winner,
// chartreuse for a shared top (a record), matching the in-app palette. One-shot:
// a rated day is frozen, so there's nothing to edit later. Never throws — a
// webhook hiccup must not disturb the rating sweep.
//
// It also carries the day's FREE-PLAY addendum: whoever reached the winning time
// off the ranked board. Those builds used to reach the channel live, as "top PB"
// posts while the daily was still open — which handed everyone still holding
// attempts the shape of the ceiling — so util/pbBoard.ts now holds that post
// until the day is rated and the records surface here instead, after the field
// is frozen. Same 10-name cap as the winners, for the same reason.

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

// At most this many tied winners are listed by name; beyond it the post states
// the count only (a big tie would otherwise blow past Discord's embed limits and
// read as a wall of names). The free-play addendum is capped the same way, and
// separately — the two lists each get their own ten.
const MAX_NAMES = 10;

// One player who reached the day's winning time without a ranked run at it.
export type FreePlayReach = { name: string; time: number };

// Players who reached (or bettered) the winning ranked time on a build that
// ISN'T on the ranked board — a free-play maze. No "was this free play?" flag is
// needed: `top` is the maximum of the ranked field, so anyone whose ranked best
// stood at it is already a winner, and every remaining player at or above it got
// there off the ranked board by construction. Ordered best-first, ties resolving
// to whoever reached it earliest — the same rule getDailyStandings and
// getIterationBests order by, so the addendum reads in the board's own order.
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

// The addendum block appended under the winners, or "" when nobody reached the
// top off the ranked board. A reach that BETTERED the winning time carries its
// own time (the interesting case — the daily's winner isn't the day's best
// build); an exact match is just a name, since the time is the one stated above.
const reachLines = (reaches: readonly FreePlayReach[], top: number): string => {
  if (reaches.length === 0) return "";
  if (reaches.length > MAX_NAMES) {
    return `\n\n${reaches.length} more players reached it in free play.`;
  }
  const lines = reaches.map((r) =>
    r.time > top ? `• ${r.name} — **${formatSeconds(r.time)}s**` : `• ${r.name}`
  );
  return `\n\nAlso reached in free play:\n${lines.join("\n")}`;
};

export const dailyEmbed = (
  winners: string[],
  time: number,
  day: Day,
  reaches: readonly FreePlayReach[] = [],
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
  description += reachLines(reaches, time);
  description += `\n\n[View the results](${url})`;

  return {
    title: `Daily results: ${date}`,
    url,
    description,
    color: solo ? GOLD : CHARTREUSE,
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
    await postResult(dailyEmbed(
      winners.map((r) => r.name ?? "anonymous"),
      top,
      [meta.y, meta.m, meta.d],
      freePlayReaches(bests, new Set(winners.map((r) => r.user)), top),
    ));
  } catch (err) {
    log.error("announceDailyResult failed", {
      iteration,
      error: errText(err),
    });
  }
};
