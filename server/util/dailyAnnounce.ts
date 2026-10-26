// The Discord "daily final" post, sent once a day is rated (rateDailies.ts):
// the ranked winners (everyone tied for the top time), named up to MAX_NAMES,
// then only the count. Gold for a sole winner, chartreuse for a shared top. A
// rated day is frozen, so the post is never edited. Never throws, so a webhook
// failure can't disturb the rating sweep.
//
// The sweep then sends a SECOND message: the day's TOP BUILD, the top of the
// best-build board and everyone holding it. util/pbBoard.ts holds live "top PB"
// posts until the day is rated; this is where the record surfaces. It is the
// same post pbBoard keeps for the rest of the day (same embed, same `pb_top`
// marker), and writing the marker is what lets a later free-play record
// SUPERSEDE it instead of standing beside it.
//
// The subject is the best build of the day, NOT who beat the ranked winner: the
// winner can hold the top build via free play and is not excluded for winning.
//
// It is a separate MESSAGE, not an addendum or second embed, so it can be
// moderated independently: deleting it leaves the daily result standing.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import {
  getDailyStandings,
  getIterationBests,
  getStandingsMeta,
} from "../db/standings.ts";
import { getPbTop, upsertPbTop } from "../db/pbTop.ts";
import {
  CHARTREUSE,
  dayUrl,
  editResult,
  GOLD,
  GREY,
  MAX_NAMES,
  postResult,
  type ResultEmbed,
} from "./discordResults.ts";
import { escapeDiscord } from "./discordText.ts";
import { errText, log } from "./logging.ts";
import { pbEmbed } from "./pbBoard.ts";

type Day = [number, number, number];

const round2 = (n: number) => Math.round(n * 100) / 100;

// The day's top build: its time, whoever got there first (credited) and the
// matchers, earliest-first, as util/pbBoard.ts orders a live record.
//
// Null when the daily summary already said it: the ranked winners ARE the top
// build and nobody joined them. A ranked run is a build like any other
// (getIterationBests maxes over every non-void run), so when the two tops are
// equal every winner is a holder, and an equal COUNT is the whole duplicate
// case.
export type TopBuild = {
  user: string;
  name: string;
  time: number;
  matchers: string[];
};

export const dayTopBuild = (
  bests: readonly {
    user: string;
    name: string | null;
    best: number;
    at: number;
  }[],
  winners: ReadonlySet<string>,
  rankedTop: number,
): TopBuild | null => {
  if (bests.length === 0) return null;
  const time = round2(Math.max(...bests.map((b) => b.best)));
  const holders = bests
    .filter((b) => round2(b.best) === time)
    .sort((a, b) => a.at - b.at);
  if (time === rankedTop && holders.length === winners.size) return null;
  const [first, ...matchers] = holders;
  if (!first) return null;
  return {
    user: first.user,
    name: first.name ?? "anonymous",
    time,
    matchers: matchers.map((b) => b.name ?? "anonymous"),
  };
};

export const dailyEmbed = (
  winners: string[],
  time: number,
  day: Day,
): ResultEmbed => {
  const url = dayUrl(day, "daily");
  const date = formatNotifDate(day);
  // Display names are player-written markdown; escape before they're set in it.
  winners = winners.map(escapeDiscord);
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

export const announceDailyResult = async (iteration: number) => {
  try {
    const [rows, bests, meta] = await Promise.all([
      getDailyStandings(iteration),
      getIterationBests(iteration),
      getStandingsMeta(iteration),
    ]);
    const [first] = rows;
    if (!first) return; // no ranked field — nothing to announce
    const top = round2(first.time);
    const winners = rows.filter((r) => round2(r.time) === top);
    const day: Day = [meta.y, meta.m, meta.d];

    await postResult(dailyEmbed(
      winners.map((r) => r.name ?? "anonymous"),
      top,
      day,
    ));

    // Awaited after the summary, not raced, so they land in that order.
    // postResult never throws, so a dropped summary doesn't cost this one.
    const record = dayTopBuild(bests, new Set(winners.map((r) => r.user)), top);
    if (!record) return;
    const count = record.matchers.length + 1;

    // Rating flips `rated` before this runs, which also unblocks pbBoard's live
    // posts, so a build landing in between may already have posted a record.
    // Grey it as pbBoard would, so the channel never shows two lit records.
    const marker = await getPbTop(iteration);
    if (marker?.messageId && marker.topTime != null) {
      await editResult(marker.messageId, {
        ...pbEmbed(
          bests.find((b) => b.user === marker.topUser)?.name ?? "anonymous",
          marker.topTime,
          marker.holders,
          day,
        ),
        color: GREY,
      });
    }

    // On success the marker makes the live path edit or supersede this message.
    const messageId = await postResult(
      pbEmbed(record.name, record.time, count, day, record.matchers),
    );
    if (messageId) {
      await upsertPbTop(iteration, messageId, record.user, record.time, count);
    }
  } catch (err) {
    log.error("announceDailyResult failed", {
      iteration,
      error: errText(err),
    });
  }
};
