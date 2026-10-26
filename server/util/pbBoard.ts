// The PB (best-build) board's side effects, run once per build that enters the
// field: a free-play commit, or a ranked build that reaches the field top (see
// routes/iteration/run/commit.ts and update.ts). Two effects share one load of
// the day's bests:
//
//   1. lost-top notifications: a prior #1/T1 holder passed by this build
//      (decideLostTop in util/lostTop.ts).
//   2. the Discord "top PB" post tracking the day's record, ONLY on a day that
//      is already RATED (a live post would spoil the ceiling for players still
//      holding attempts; see onPbBuild). Rules, driven by the `pb_top` marker:
//      - a new holder taking the top (a record-break or the day's first PB)
//        posts fresh;
//      - a build MATCHING the announced top edits it with the tie count;
//      - the SAME holder improving their lead edits within 12h
//        (PB_EDIT_WINDOW_MS) and posts fresh past it OR once the record has
//        been matched in between;
//      - ties, non-topping builds and replays do nothing.
//
// Neither throws: a notification/webhook failure must not fail the run. Callers
// AWAIT onPbBuild: the shutdown drain waits only for in-flight requests, so
// work left running past the response dies with a deploy's restart.

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
import { escapeDiscord } from "./discordText.ts";
import { errText, log } from "./logging.ts";
import { type BestRow, decideLostTop } from "./lostTop.ts";
import { notifyLostTop } from "./notify.ts";

type Day = [number, number, number];

// A best-build row plus when the player FIRST reached it (`at`, ms epoch); the
// earliest setter of a shared top is the holder the post credits.
type Best = BestRow & { at: number };

// Times are stored to two decimals; round back to that grid so top equality is
// exact.
const round2 = (n: number) => Math.round(n * 100) / 100;

// How long the standing post absorbs the SAME holder's improvements as edits
// before one earns a fresh message. Anchored at the post, not each edit (see
// editPbTop), so a slow climb still re-posts 12h after it began.
export const PB_EDIT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Whether this build makes the actor a NEW top holder: a record-break (exactly
// the event that sets a lost-top notification) or the day's first PB (the sole
// player bettering their own best). The actor's prior best guards against
// replays: a build by someone already leading, or below the top, returns null.
// Pure; the once-only guard is the marker.
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

// What the Discord post should do, given the board state and the marker. Pure.
//   - "post": the actor NEWLY took the sole top (`newHolder`); or holds the
//     announced top and improved it, but the record has since been matched or
//     the post is past the window.
//   - "edit": the actor holds the announced top and improved it within the
//     window while still sole; or a build just matched the announced top.
//   - "none": anything else.
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
    // The announced holder: only their own IMPROVEMENT does anything. Edit
    // within the window, else re-post; a match in between (marker.holders > 1)
    // also forces a fresh post.
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

// The record post's embed: gold for a sole holder, chartreuse once matched; the
// title links to the day's PB board.
//
// A matched top NAMES its matchers. Past MAX_NAMES, or when `matchers` is
// omitted (the grey-out path rebuilds a SUPERSEDED message from the marker,
// which stores only the count), it falls back to the count.
export const pbEmbed = (
  name: string,
  time: number,
  count: number,
  day: Day,
  matchers?: readonly string[],
): ResultEmbed => {
  const url = dayUrl(day, "pb");
  const date = formatNotifDate(day);
  // Display names are player-written markdown; escape before they're set in it.
  name = escapeDiscord(name);
  matchers = matchers?.map(escapeDiscord);
  const opener = `**${name}** set the top build of ${date} at **${
    formatSeconds(time)
  }s**.`;
  const matched = count - 1;
  // The matchers by name when every one is known and there are few enough.
  const names = matchers?.length === matched && matched <= MAX_NAMES
    ? matchers
    : undefined;

  let description = opener;
  if (matched === 1) {
    const [only] = names ?? [];
    description += only === undefined
      ? " 1 player has matched it."
      : ` Matched by **${only}**.`;
  } else if (matched > 1) {
    description += names
      ? ` Matched by:\n${names.map((m) => `• ${m}`).join("\n")}`
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
  // Earliest-first: the first to reach the top is credited; the rest are
  // matchers.
  const holders = bests
    .filter((b) => round2(b.best) === top)
    .sort((a, b) => a.at - b.at);
  const [holder] = holders;
  if (!holder) return;
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
  // A standing message deleted in Discord can't be edited: post afresh instead
  // of retrying the PATCH on every build until the edit window lapses.
  const edited = action === "edit" && marker?.messageId
    ? await editResult(marker.messageId, embed)
    : null;
  if (edited === "ok") {
    // editPbTop leaves the window anchor alone, so edits can't defer a re-post.
    await editPbTop(iteration, top, holders.length);
  } else if (edited === "failed") {
    // Leave the marker; the next build retries the edit.
  } else {
    // A fresh post supersedes the standing message: grey the old one out first,
    // rebuilt from the marker (the name is re-derived from the holder's current
    // row). Greying first means a failed post retries, and re-greys, on the
    // next save rather than leaving two coloured messages. topTime is non-null
    // whenever messageId is (written together).
    if (edited !== "gone" && marker?.messageId && marker.topTime != null) {
      const prevName = bests.find((b) => b.user === marker.topUser)?.name ??
        "anonymous";
      await editResult(marker.messageId, {
        ...pbEmbed(prevName, marker.topTime, marker.holders, day),
        color: GREY,
      });
    }
    // Also reached by an "edit" whose message is gone or was never recorded.
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

    // Tell whoever this build passed.
    const decision = decideLostTop(bests, actor, prev);
    const { passer } = decision;
    const lostTop = passer
      ? Promise.all(
        decision.recipients.map((r) =>
          notifyLostTop(r.user, iteration, day, {
            passer: passer.name,
            passerTime: passer.time,
            yourTime: r.yourTime,
          })
        ),
      )
      : Promise.resolve();

    // The Discord record post is HELD until the day is rated: a "new top build"
    // in the channel would show everyone still holding ranked attempts the
    // ceiling. The in-app lost-top notification is unaffected: it goes to one
    // player about their own record, on a surface reached after their attempts.
    // The day's record reaches the channel as the top-build post in
    // util/dailyAnnounce.ts.
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
