// The PB (best-build) board's post-build side effects, run once per build that
// enters the field — a free-play commit, or a ranked build that reaches the field
// top (see run/commit.ts and run/update.ts). Two effects share one load of the
// day's bests:
//
//   1. lost-top notifications — a prior #1/T1 holder passed by this build
//      (decideLostTop; its tie/lead edge cases are unit-tested in lostTop.ts).
//   2. the Discord "top PB" post — a message tracking the day's current record.
//      A NEW holder taking the top (a record-break, the same event that sets a
//      lost-top notification; or the day's first PB) posts a fresh message. The
//      SAME holder improving their own lead edits that message within a 12h window
//      (PB_EDIT_WINDOW_MS) and posts a fresh one past it. Ties, non-topping builds,
//      and replays that don't take the top do nothing — so replaying an old board
//      can't resurface its record. A `pb_top` marker (who holds the announced top,
//      the message, its time, and when it posted) is the state that drives this.
//
// Both never throw — a notification/webhook hiccup must not fail the run — and the
// caller AWAITs onPbBuild because this Deploy kills work left running past the
// response.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import {
  bumpPbTopTime,
  getPbTop,
  type PbTop,
  upsertPbTop,
} from "../db/pbTop.ts";
import { getUserPrevBest } from "../db/run.ts";
import { getIterationBests, getStandingsMeta } from "../db/standings.ts";
import {
  dayUrl,
  editResult,
  GOLD,
  postResult,
  type ResultEmbed,
} from "./discordResults.ts";
import { errText, log } from "./logging.ts";
import { type BestRow, decideLostTop } from "./lostTop.ts";
import { notifyLostTop } from "./notify.ts";

type Day = [number, number, number];

// How long the standing post absorbs the SAME holder's own improvements as edits
// before a further one earns a fresh message. Anchored at the post, not each edit
// (see bumpPbTopTime), so a long slow climb still re-posts 12h after it began.
export const PB_EDIT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Whether this build makes the actor a NEW top holder — a record-break (reusing
// the lost-top pass detection, so it fires on exactly the event that sets a
// lost-top notification) or the day's first PB (the sole player bettering their
// own best, where there's no one to pass). The actor's prior best guards against a
// replay: a build by someone already leading, or below the top, returns null. Pure
// so its branches are unit-testable; the burst/dup guard is the pb_top marker.
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

// What the Discord post should do given the board state and the marker. Pure so
// its branches are unit-testable without a webhook or a clock:
//   - "post": the actor NEWLY took the top (`newHolder`), or the actor already
//     holds the announced top and improved it past the edit window (stale) or with
//     no message to edit — a fresh message goes up.
//   - "edit": the actor holds the announced top and improved it within the window —
//     the standing message's time is updated in place.
//   - "none": the actor isn't the outright top (a tie or below), or holds it but
//     didn't improve — nothing changed.
export const decidePbAction = (
  isTop: boolean,
  me: number,
  newHolder: boolean,
  marker: { topUser: string; topTime: number; hasMessage: boolean } | null,
  actor: string,
  staleForHolder: boolean,
): "post" | "edit" | "none" => {
  if (marker && marker.topUser === actor) {
    if (!isTop || me <= marker.topTime) return "none";
    return staleForHolder || !marker.hasMessage ? "post" : "edit";
  }
  return newHolder ? "post" : "none";
};

// The record post's embed — gold (an outright top; ties aren't announced). The
// title links to the day's PB board.
export const pbEmbed = (name: string, time: number, day: Day): ResultEmbed => {
  const url = dayUrl(day, "pb");
  const date = formatNotifDate(day);
  return {
    title: `Top PB: ${date}`,
    url,
    description:
      `**${name}** set the top build of ${date} at **${
        formatSeconds(time)
      }s**.` +
      `\n\n[Open the puzzle](${url})`,
    color: GOLD,
  };
};

const announce = async (
  iteration: number,
  actor: string,
  bests: BestRow[],
  prev: number | null,
  day: Day,
  marker: PbTop | null,
) => {
  const me = bests.find((b) => b.user === actor);
  if (!me) return;
  const othersTop = bests.reduce(
    (max, b) => (b.user === actor ? max : Math.max(max, b.best)),
    -Infinity,
  );
  const isTop = me.best > othersTop;
  const newHolder = topPbToAnnounce(bests, actor, prev) !== null;

  const staleForHolder = marker != null && marker.topUser === actor &&
    (marker.announcedAt == null ||
      Date.now() - marker.announcedAt >= PB_EDIT_WINDOW_MS);

  const action = decidePbAction(
    isTop,
    me.best,
    newHolder,
    marker && {
      topUser: marker.topUser,
      topTime: marker.topTime ?? -Infinity,
      hasMessage: marker.messageId != null,
    },
    actor,
    staleForHolder,
  );

  if (action === "edit" && marker?.messageId) {
    // Edit the standing message; bumpPbTopTime leaves the window anchor untouched
    // so a burst of edits can't defer the past-window re-post.
    if (await editResult(marker.messageId, pbEmbed(me.name, me.best, day))) {
      await bumpPbTopTime(iteration, me.best);
    }
  } else if (action === "post") {
    // Advance the marker only on a successful post (stamping a fresh window), so a
    // failed one retries on the next qualifying save rather than being swallowed.
    const messageId = await postResult(pbEmbed(me.name, me.best, day));
    if (messageId) await upsertPbTop(iteration, messageId, actor, me.best);
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
    const bests: BestRow[] = bestsRaw.map((b) => ({
      user: b.user,
      name: b.name ?? "anonymous",
      best: b.best,
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

    await Promise.all([
      lostTop,
      announce(iteration, actor, bests, prev, day, marker),
    ]);
  } catch (err) {
    log.error("onPbBuild failed", { error: errText(err) });
  }
};
