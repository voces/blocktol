// The Discord "daily final" post, sent once a day is rated (util/rateDailies.ts).
// Renders the winners of the ranked daily board — everyone tied for the top time
// — up to 10 by name; past 10 it states the count only. Gold for a sole winner,
// chartreuse for a shared top (a record), matching the in-app palette. One-shot:
// a rated day is frozen, so there's nothing to edit later. Never throws — a
// webhook hiccup must not disturb the rating sweep.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import { getDailyStandings, getStandingsMeta } from "../db/standings.ts";
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
// read as a wall of names).
const MAX_NAMES = 10;

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
    description =
      `${winners.length} players tied for the top at **${t}** — a record:\n${
        winners.map((w) => `• ${w}`).join("\n")
      }`;
  } else {
    description =
      `${winners.length} players tied for the top at **${t}** — a record.`;
  }
  description += `\n\n[View the results](${url})`;

  return {
    title: `Daily results — ${date}`,
    url,
    description,
    color: solo ? GOLD : CHARTREUSE,
  };
};

export const announceDailyResult = async (iteration: number) => {
  try {
    const [rows, meta] = await Promise.all([
      getDailyStandings(iteration),
      getStandingsMeta(iteration),
    ]);
    if (rows.length === 0) return; // no ranked field — nothing to announce
    const top = round2(rows[0].time);
    const winners = rows
      .filter((r) => round2(r.time) === top)
      .map((r) => r.name ?? "anonymous");
    await postResult(dailyEmbed(winners, top, [meta.y, meta.m, meta.d]));
  } catch (err) {
    log.error("announceDailyResult failed", {
      iteration,
      error: errText(err),
    });
  }
};
