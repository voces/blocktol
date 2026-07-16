// The PB (best-build) board's post-build side effects, run once per build that
// enters the field — a free-play commit, or a ranked build that reaches the field
// top (see run/commit.ts and run/update.ts). Two effects share one load of the
// day's bests:
//
//   1. lost-top notifications — a prior #1/T1 holder passed by this build
//      (decideLostTop; its tie/lead edge cases are unit-tested in lostTop.ts).
//   2. the Discord "top PB" post — announced on a change of the board's top
//      holder: a record-break (the same event that sets a lost-top notification)
//      or the day's first PB. It never edits; a `pb_top` marker (who currently
//      holds the announced top) is all that's kept, so a burst of leading saves —
//      or a replay of an old board — can't re-post.
//
// Both never throw — a notification/webhook hiccup must not fail the run — and the
// caller AWAITs onPbBuild because this Deploy kills work left running past the
// response.

import { formatNotifDate } from "../../common/notifications.ts";
import { formatSeconds } from "../../common/format.ts";
import { getPbTop, upsertPbTop } from "../db/pbTop.ts";
import { getUserPrevBest } from "../db/run.ts";
import { getIterationBests, getStandingsMeta } from "../db/standings.ts";
import {
  dayUrl,
  GOLD,
  postResult,
  type ResultEmbed,
} from "./discordResults.ts";
import { errText, log } from "./logging.ts";
import { type BestRow, decideLostTop } from "./lostTop.ts";
import { notifyLostTop } from "./notify.ts";

type Day = [number, number, number];

// Who to announce as the new top PB, or null. A record-break reuses the lost-top
// pass detection — so the Discord post fires on exactly the event that sets a
// lost-top notification. The day's first PB has no one to pass (and so no
// notification), so it's handled separately: the sole player on the board
// improving their own best. Pure; the once-only guard is the pb_top marker in
// onPbBuild, not here — this returns the same target on every save of a burst, and
// the marker collapses that to one post. (A non-improving replay returns null, so
// merely revisiting an old board never announces.)
export const topPbToAnnounce = (
  bests: readonly BestRow[],
  actor: string,
  prev: number | null,
): { name: string; time: number } | null => {
  const decision = decideLostTop(bests, actor, prev);
  if (decision.passer) return decision.passer;
  // First PB: the actor is the only player with a build, and this build bettered
  // their own prior best (so a worse/equal replay of a solo board is silent).
  const me = bests.find((b) => b.user === actor);
  if (bests.length === 1 && me && me.best > (prev ?? -Infinity)) {
    return { name: me.name, time: me.best };
  }
  return null;
};

// The record post's embed — gold (an outright new top; there are no ties to render
// now that the post fires only on a holder change). The title links to the day's
// PB board.
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

export const onPbBuild = async (iteration: number, actor: string) => {
  try {
    const [bestsRaw, prev, meta, topUser] = await Promise.all([
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

    // Discord post: only when this build makes the actor a NEW top holder, and the
    // marker doesn't already credit them (dedupes a burst of leading saves — the
    // actor stays the passer/sole player across the burst — to a single post).
    const announce = (async () => {
      const target = topPbToAnnounce(bests, actor, prev);
      if (!target || topUser === actor) return;
      const posted = await postResult(pbEmbed(target.name, target.time, day));
      // Advance the marker only on a successful post, so a failed one retries on
      // the next qualifying save rather than being silently swallowed.
      if (posted) await upsertPbTop(iteration, actor);
    })();

    await Promise.all([lostTop, announce]);
  } catch (err) {
    log.error("onPbBuild failed", { error: errText(err) });
  }
};
