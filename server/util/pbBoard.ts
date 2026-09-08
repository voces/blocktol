// The PB (best-build) board's post-build side effects, run once per build that
// enters the field — a free-play commit, or a ranked build that reaches the field
// top (see run/commit.ts and run/update.ts). Two effects share one load of the
// day's bests:
//
//   1. lost-top notifications — a prior #1/T1 holder passed by this build
//      (decideLostTop; its tie/lead edge cases are unit-tested in lostTop.ts).
//   2. the Discord "top PB" post — a message tracking the day's current record on
//      the PB board, and ONLY on a day that is already RATED (see onPbBuild: while
//      the daily is live the post would spoil the ceiling for everyone still
//      holding attempts; the daily-final post carries the day's records instead).
//      A new holder taking the top (a record-break — the event that sets a lost-top
//      notification — or the day's first PB) posts a fresh message; a build MATCHING
//      the announced top edits it with the tie count (chartreuse); the SAME holder
//      improving their own lead edits it within a 12h window and posts a fresh one
//      past it OR once the record has been matched in between (breaking a shared
//      record is its own event). Ties/non-topping builds/replays that don't take the
//      top do nothing. A `pb_top` marker (holder, message, time, tie count, post
//      time) is the state that drives this.
//
// Both never throw — a notification/webhook hiccup must not fail the run — and the
// caller AWAITs onPbBuild because this Deploy kills work left running past the
// response.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import { editPbTop, getPbTop, type PbTop, upsertPbTop } from "../db/pbTop.ts";
import { getUserPrevBest } from "../db/run.ts";
import { getIterationBests, getStandingsMeta } from "../db/standings.ts";
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
import { type BestRow, decideLostTop } from "./lostTop.ts";
import { notifyLostTop } from "./notify.ts";

type Day = [number, number, number];

// A best-build row plus when the player FIRST reached it (`at`, ms epoch) — the
// earliest setter of a shared top is the holder the post credits.
type Best = BestRow & { at: number };

// Times are stored to two decimals; round the float MAX back to that grid so top
// equality (a match of the current top) is exact rather than float-fuzzy.
const round2 = (n: number) => Math.round(n * 100) / 100;

// How long the standing post absorbs the SAME holder's own improvements as edits
// before a further one earns a fresh message. Anchored at the post, not each edit
// (see editPbTop), so a long slow climb still re-posts 12h after it began.
export const PB_EDIT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Whether this build makes the actor a NEW top holder — a record-break (reusing
// the lost-top pass detection, so it fires on exactly the event that sets a
// lost-top notification) or the day's first PB (the sole player bettering their own
// best). The actor's prior best guards against a replay: a build by someone already
// leading, or below the top, returns null. Pure; the once-only guard is the marker.
export const topPbToAnnounce = (
  bests: readonly BestRow[],
  actor: string,
  prev: number | null,
): { name: string; time: number } | null => {
  const decision = decideLostTop(bests, actor, prev);
  if (decision.passer) return decision.passer;
  const me = bests.find((b) => b.user === actor);
  if (bests.length === 1 && me && me.best > (prev ?? -Infinity)) {
    return { name: me.name, time: me.best };
  }
  return null;
};

// What the Discord post should do, given the board state and the marker. Pure so
// its branches are unit-testable without a webhook or a clock:
//   - "post": the actor NEWLY took the sole top (`newHolder`, replay-safe); or the
//     actor holds the announced top and improved it, but the record has been matched
//     since the post (a shared record they're now breaking) or the post is stale
//     (past the window) — a fresh message goes up.
//   - "edit": the actor holds the announced top and improved it within the window
//     while still sole; OR a build just matched the announced top (the tie count
//     grew) — the standing message is updated in place.
//   - "none": the actor isn't the outright top and didn't just match it, or holds
//     it but didn't improve — nothing changed.
export const decidePbAction = (
  isTop: boolean, // actor is (one of) the current top holder(s), incl. a tie
  me: number, // actor's current best, rounded
  count: number, // players at the current top
  newHolder: boolean, // topPbToAnnounce — a replay-safe new SOLE top
  marker: { topUser: string; topTime: number; holders: number } | null,
  actor: string,
  stale: boolean, // marker is the actor's and older than the edit window
): "post" | "edit" | "none" => {
  if (marker && marker.topUser === actor) {
    // The announced holder. Only their own IMPROVEMENT (while still the sole top)
    // does anything — edit within the window, else re-post; a match in between
    // (marker.holders > 1) also breaks the seal into a fresh post.
    if (!isTop || me <= marker.topTime) return "none";
    return stale || marker.holders > 1 ? "post" : "edit";
  }
  if (newHolder) return "post";
  // A different player who just MATCHED the announced top: edit the tie count.
  if (marker && isTop && me === marker.topTime && count > marker.holders) {
    return "edit";
  }
  return "none";
};

// The record post's embed. Gold for a sole holder, chartreuse once matched. The
// title links to the day's PB board.
//
// A matched top NAMES who matched it. A bare tally ("1 player has matched it")
// tells you the record is shared without telling you the one thing you'd want to
// know, and a day's top is shared by a handful of players at most. Past
// MAX_NAMES it falls back to the count, as every list in this channel does — and
// so does the grey-out path, which rebuilds a SUPERSEDED message from the marker
// and has only its count stored (a message nobody is reading any more, so the
// shape it collapses to costs nothing).
export const pbEmbed = (
  name: string,
  time: number,
  count: number,
  day: Day,
  matchers?: readonly string[],
): ResultEmbed => {
  const url = dayUrl(day, "pb");
  const date = formatNotifDate(day);
  const opener = `**${name}** set the top build of ${date} at **${
    formatSeconds(time)
  }s**.`;
  const matched = count - 1;
  const named = matchers?.length === matched && matched <= MAX_NAMES;

  let description = opener;
  if (matched === 1) {
    description += named
      ? ` Matched by **${matchers![0]}**.`
      : " 1 player has matched it.";
  } else if (matched > 1) {
    description += named
      ? ` Matched by:\n${matchers!.map((m) => `• ${m}`).join("\n")}`
      : ` ${matched} players have matched it.`;
  }

  return {
    title: `Top PB: ${date}`,
    url,
    description: `${description}\n\n[Open the puzzle](${url})`,
    color: count > 1 ? CHARTREUSE : GOLD,
  };
};

const announce = async (
  iteration: number,
  actor: string,
  bests: Best[],
  prev: number | null,
  day: Day,
  marker: PbTop | null,
) => {
  if (bests.length === 0) return;
  const top = round2(Math.max(...bests.map((b) => b.best)));
  // Earliest-first: the first to reach the top time is the holder the post
  // credits, and the rest are its matchers, in the order they got there.
  const holders = bests
    .filter((b) => round2(b.best) === top)
    .sort((a, b) => a.at - b.at);
  const holder = holders[0];
  const actorAtTop = holders.some((h) => h.user === actor);

  const stale = marker != null && marker.topUser === actor &&
    (marker.announcedAt == null ||
      Date.now() - marker.announcedAt >= PB_EDIT_WINDOW_MS);

  const action = decidePbAction(
    actorAtTop,
    top,
    holders.length,
    topPbToAnnounce(bests, actor, prev) !== null,
    marker && {
      topUser: marker.topUser,
      topTime: marker.topTime ?? -Infinity,
      holders: marker.holders,
    },
    actor,
    stale,
  );
  if (action === "none") return;

  const embed = pbEmbed(
    holder.name,
    top,
    holders.length,
    day,
    holders.slice(1).map((h) => h.name),
  );
  if (action === "edit" && marker?.messageId) {
    // Edit the standing message; editPbTop leaves the window anchor untouched so a
    // burst of edits can't defer the past-window re-post.
    if (await editResult(marker.messageId, embed)) {
      await editPbTop(iteration, top, holders.length);
    }
  } else {
    // A fresh post supersedes the standing message: grey out the old one first (so
    // the channel highlights only the current record), then post the new. Its
    // content is reconstructed from the marker — topTime/holders are the old
    // message's current values, the name re-derived from the still-present holder.
    // Greying first means a failed post just retries (and re-greys) next save,
    // rather than stranding two coloured messages. topTime is non-null whenever a
    // message id is (both are written together).
    if (marker?.messageId && marker.topTime != null) {
      const prevName = bests.find((b) => b.user === marker.topUser)?.name ??
        "anonymous";
      await editResult(marker.messageId, {
        ...pbEmbed(prevName, marker.topTime, marker.holders, day),
        color: GREY,
      });
    }
    // A fresh post (or an "edit" with no message to PATCH — a pre-column marker).
    // Advance the marker only on success, so a failed post retries next save.
    const messageId = await postResult(embed);
    if (messageId) {
      await upsertPbTop(iteration, messageId, holder.user, top, holders.length);
    }
  }
};

export const onPbBuild = async (iteration: number, actor: string) => {
  try {
    const [bestsRaw, prev, meta, marker] = await Promise.all([
      getIterationBests(iteration),
      getUserPrevBest(actor, iteration),
      getStandingsMeta(iteration),
      getPbTop(iteration),
    ]);
    const bests: Best[] = bestsRaw.map((b) => ({
      user: b.user,
      name: b.name ?? "anonymous",
      best: b.best,
      at: b.at,
    }));
    const day: Day = [meta.y, meta.m, meta.d];

    // Lost-top notifications (unchanged): tell whoever this build passed.
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

    // The Discord record post is HELD until the day is rated. While the daily is
    // still live, a "new top build" in the results channel is a heads-up on what
    // the puzzle can do: it hands everyone who hasn't spent their three ranked
    // attempts the shape of the ceiling. The in-app lost-top card above stays —
    // it's addressed to one player, about their own record, on a surface they
    // only reach after their attempts. Once the field is frozen and the ELOs are
    // written there is nothing left to leak, so a later free-play record on a
    // rated day posts (and edits) exactly as before. The day's live records reach
    // the channel instead as the daily-final post's free-play addendum
    // (util/dailyAnnounce.ts).
    await Promise.all([
      lostTop,
      meta.rated
        ? announce(iteration, actor, bests, prev, day, marker)
        : Promise.resolve(),
    ]);
  } catch (err) {
    log.error("onPbBuild failed", { error: errText(err) });
  }
};
