// The Discord "daily final" post, sent once a day is rated (util/rateDailies.ts).
// Renders the winners of the ranked daily board — everyone tied for the top time
// — up to 10 by name; past 10 it states the count only. Gold for a sole winner,
// chartreuse for a shared top (a record), matching the in-app palette. One-shot:
// a rated day is frozen, so there's nothing to edit later. Never throws — a
// webhook hiccup must not disturb the rating sweep.
//
// The same sweep sends a SECOND, separate message: the day's TOP BUILD — the top
// of the best-build board and everyone holding it. Those records used to reach
// the channel live, as "top PB" posts while the daily was still open, which
// handed everyone still holding attempts the shape of the ceiling; util/pbBoard.ts
// holds that post until the day is rated, and this is where the day's own record
// surfaces instead, after the field is frozen.
//
// It is literally the same post pbBoard keeps for the rest of the day — same
// embed, same `pb_top` marker — because it is the same fact. That matters:
// writing the marker is what makes a later free-play record SUPERSEDE this
// message (greying it) instead of standing a second lit record post beside it.
//
// It used to be a different post, and a wrong one. It listed whoever had reached
// the RANKED winning time off the ranked board, which got all of: the bar (the
// ranked winner's time, which the best-build board is not measured against), the
// people (anyone above that bar, most of whom hold no record at all), and the
// omissions (the daily's winner was excluded for being a winner, even when their
// own free play held the day's top build) wrong at once. The subject was never
// "who beat the ranked winner" — it is "what is the best build of the day".
//
// It stays a separate MESSAGE rather than an addendum inside the summary (or a
// second embed on the same post) so the two can be moderated independently: the
// record post carries its own message id, so deleting or editing it away leaves
// the daily's own result standing untouched.

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
import { errText, log } from "./logging.ts";
import { pbEmbed } from "./pbBoard.ts";

type Day = [number, number, number];

const round2 = (n: number) => Math.round(n * 100) / 100;

// The day's top build: its time, whoever got there first (the holder the post
// credits) and everyone who matched them, earliest-first — the same ordering
// util/pbBoard.ts credits a live record by, so the sweep's post and the live one
// read identically.
//
// Null when the best-build board has nothing the daily summary didn't already
// say: the ranked winners ARE the top build, and nobody joined them. A ranked run
// is a build like any other (getIterationBests takes the max over every non-void
// run), so whenever the two tops are EQUAL every winner is necessarily a holder —
// which is what makes "same time, same number of people" the whole of the
// duplicate case, with no set comparison needed.
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
  return {
    user: holders[0].user,
    name: holders[0].name ?? "anonymous",
    time,
    matchers: holders.slice(1).map((b) => b.name ?? "anonymous"),
  };
};

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

    // The day's record post, sent after the summary and awaited in turn rather
    // than raced with it, so the two land in the channel in that order.
    // postResult never throws and reports its own failures, so a dropped summary
    // doesn't cost us this one — the record post reads on its own.
    const record = dayTopBuild(bests, new Set(winners.map((r) => r.user)), top);
    if (!record) return;
    const count = record.matchers.length + 1;

    // Rating flips `rated` before this runs, which is also what unblocks
    // pbBoard's live posts — so a build landing in between can already have
    // stood a record message up. Grey it exactly as a fresh post there would, so
    // the channel never shows two lit records for one day. Normally there is no
    // marker at all and this is a single read.
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

    // Claim the marker on success: from here the live path treats this message
    // as the standing record and edits or supersedes it, rather than opening a
    // second one.
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
