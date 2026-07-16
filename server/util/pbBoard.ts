// The PB (best-build) board's post-build side effects, run once per build that
// enters the field — a free-play commit, or a ranked build that reaches the
// field top (see run/commit.ts and run/update.ts). Two effects share one load of
// the day's bests:
//
//   1. lost-top notifications — a prior #1/T1 holder passed by this build
//      (decideLostTop; its tie/lead edge cases are unit-tested in lostTop.ts).
//   2. the Discord "top PB" post — a new day record is posted; when players later
//      match it, that same post is edited with the tie count (decidePbAnnouncement
//      below, also unit-tested).
//
// Both never throw — a notification/webhook hiccup must not fail the run — and
// the caller AWAITs onPbBuild because this Deploy kills work left running past
// the response.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import {
  editPbAnnouncement,
  getPbAnnouncement,
  upsertPbAnnouncement,
} from "../db/pbAnnouncement.ts";
import { getUserPrevBest } from "../db/run.ts";
import { getIterationBests, getStandingsMeta } from "../db/standings.ts";
import {
  CHARTREUSE,
  dayUrl,
  editResult,
  GOLD,
  postResult,
  type ResultEmbed,
} from "./discordResults.ts";
import { errText, log } from "./logging.ts";
import { decideLostTop } from "./lostTop.ts";
import { notifyLostTop } from "./notify.ts";

type Day = [number, number, number];

// A best-build row for the day: a player, their best time, and when they FIRST
// reached it (`at`, ms epoch — the earliest setter of a shared top is the record
// holder, matching getDailyStandings' tie rule).
type Best = { user: string; name: string; best: number; at: number };

// Times are stored to two decimals; round the float MAX back to that grid so top
// equality (a tie of the current top) is exact rather than float-fuzzy.
const round2 = (n: number) => Math.round(n * 100) / 100;

// How long the standing post absorbs a holder's own improvements before a further
// one earns a fresh message. Under it, a same-holder climb is one save-burst and
// edits in place; over it, the improvement is a return visit (a later session /
// the next day) worth its own post. Anchored at the post, not each edit (see
// editPbAnnouncement), so a long slow climb still re-posts 12h after it began.
export const PB_RECORD_RESET_MS = 12 * 60 * 60 * 1000;

// What to do with the Discord record post given the day's current top (its time,
// its holder — the earliest to reach it — and how many share it) against the post
// we last made (null = none yet). `sameHolderStale` is true when the standing
// post is older than PB_RECORD_RESET_MS — a same-holder improvement then reads as
// a return visit, not a burst. Pure so its branches are unit-testable without a
// webhook or a clock:
//   - "post": the first record of the day; a strictly higher top taken by a
//     DIFFERENT holder (a lead change); or the same holder improving their own top
//     when that's no longer part of one live burst — the record has since been
//     MATCHED by someone else (breaking a shared record is its own event) or the
//     post has gone stale (a return visit hours later). A fresh message goes up.
//   - "edit": the standing record evolved as part of the holder's own live climb —
//     they pushed their still-unmatched top higher within the window — or more
//     players matched the current top. The existing message is updated in place.
//     Editing the same-holder climb is what keeps one player's burst (many leading
//     saves in a 60s window) to a single message rather than a spray of posts.
//   - "none": nothing changed (or the top somehow regressed, which can't happen).
export const decidePbAnnouncement = (
  top: number,
  holder: string,
  holders: number,
  stored: { topTime: number; topUser: string; holders: number } | null,
  sameHolderStale: boolean,
): "post" | "edit" | "none" => {
  if (!stored) return "post";
  if (top > stored.topTime) {
    if (holder !== stored.topUser) return "post"; // lead change
    // Same holder improving their own top. Edit to collapse a live save-burst,
    // but post anew once that framing breaks: the record was matched in between
    // (holders > 1, so this improvement breaks a shared record) or the post is
    // stale (a return visit). Both are competitive events worth their own message.
    return sameHolderStale || stored.holders > 1 ? "post" : "edit";
  }
  if (top === stored.topTime && holders > stored.holders) return "edit";
  return "none";
};

// The record post's embed. Gold for a sole holder (an outright top), chartreuse
// for a matched one (a shared record) — the same palette the in-app board uses.
// The title links straight to the day's PB board.
export const pbEmbed = (
  holder: string,
  time: number,
  holders: number,
  day: Day,
): ResultEmbed => {
  const url = dayUrl(day, "pb");
  const date = formatNotifDate(day);
  const t = `${formatSeconds(time)}s`;
  const solo = holders <= 1;
  const matched = holders - 1;
  // Same opening line whether solo or matched; a match just appends the tally.
  // The shared-record signal is the chartreuse colour, not words.
  const opener = `**${holder}** set the top build of ${date} at **${t}**.`;
  const tally = ` ${matched} ${
    matched === 1 ? "player has" : "players have"
  } matched.`;
  const description = `${
    solo ? opener : opener + tally
  }\n\n[Open the puzzle](${url})`;
  return {
    title: `Top PB: ${date}`,
    url,
    description,
    color: solo ? GOLD : CHARTREUSE,
  };
};

// Post or edit the day's record based on the current bests. Idempotent against
// the stored post state, so a stream of leading/tying saves within one attempt
// posts once and only re-edits when the tie count actually grows.
const announceRecord = async (
  iteration: number,
  bests: Best[],
  day: Day,
  stored: Awaited<ReturnType<typeof getPbAnnouncement>>,
) => {
  if (bests.length === 0) return;
  const top = round2(Math.max(...bests.map((b) => b.best)));
  const holders = bests.filter((b) => round2(b.best) === top);
  // The earliest to reach the top time is the record holder shown on the post.
  const holder = holders.reduce((a, b) => (a.at <= b.at ? a : b));

  const sameHolderStale = stored != null &&
    Date.now() - stored.announcedAt >= PB_RECORD_RESET_MS;
  const action = decidePbAnnouncement(
    top,
    holder.user,
    holders.length,
    stored,
    sameHolderStale,
  );
  if (action === "none") return;

  const embed = pbEmbed(holder.name, top, holders.length, day);
  if (action === "post") {
    const messageId = await postResult(embed);
    // Only persist state once we have a message id to edit later; a failed post
    // leaves no row, so the next qualifying build simply retries the post. The
    // upsert stamps announced_at to now — resetting the same-holder window.
    if (messageId) {
      await upsertPbAnnouncement(
        iteration,
        messageId,
        top,
        holder.user,
        holders.length,
      );
    }
  } else if (stored) {
    // Edit the standing message in place; editPbAnnouncement leaves announced_at
    // (the window anchor) untouched so a burst of edits can't defer the re-post.
    await editResult(stored.messageId, embed);
    await editPbAnnouncement(iteration, top, holder.user, holders.length);
  }
};

export const onPbBuild = async (iteration: number, actor: string) => {
  try {
    const [bestsRaw, prev, meta, stored] = await Promise.all([
      getIterationBests(iteration),
      getUserPrevBest(actor, iteration),
      getStandingsMeta(iteration),
      getPbAnnouncement(iteration),
    ]);
    const bests: Best[] = bestsRaw.map((b) => ({
      user: b.user,
      name: b.name ?? "anonymous",
      best: b.best,
      at: b.at,
    }));
    const day: Day = [meta.y, meta.m, meta.d];

    // Lost-top notifications (strict pass only) and the Discord record post/edit
    // run off the same bests. Fire both together; each is internally deduped.
    const decision = decideLostTop(bests, actor, prev);
    const lostTop = decision.passer
      ? Promise.all(
        decision.recipients.map((r) =>
          notifyLostTop(r.user, iteration, day, {
            passer: decision.passer!.name,
            passerTime: decision.passer!.time,
            yourTime: r.yourTime,
          })
        ),
      )
      : Promise.resolve();

    await Promise.all([lostTop, announceRecord(iteration, bests, day, stored)]);
  } catch (err) {
    log.error("onPbBuild failed", { error: errText(err) });
  }
};
