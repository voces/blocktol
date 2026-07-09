// "Someone passed your #1" on the PB (best-build) board. The decision is a pure
// function of the day's current bests plus the actor's PB *before* their new
// build, so its tie/lead edge cases are unit-testable; checkLostTop wires it to
// the database and the notifier.
//
// Only fires on a free-play commit (see run/commit.ts) — the once-per-run moment
// a build enters the PB field — never on every autosave. Scoped to the PB board
// per the product decision: notify a prior #1/T1 holder who was passed or, if
// they were the sole #1, newly tied.

import { getUserPrevBest } from "../db/run.ts";
import { getIterationBests, getStandingsMeta } from "../db/standings.ts";
import { log } from "./logging.ts";
import { notifyLostTop } from "./notify.ts";

export type BestRow = { user: string; name: string; best: number };

export type LostTopDecision = {
  passer: { name: string; time: number } | null;
  recipients: { user: string; yourTime: number }[];
};

const NONE: LostTopDecision = { passer: null, recipients: [] };

/**
 * Decide who just lost the top of the PB board when `actor`'s new build landed.
 * Only a strict PASS costs a holder the top — a tie doesn't — so a tie fires
 * nothing.
 *
 * `actorPrevBest` is the actor's best build BEFORE this run (null = none). The
 * guard on it is what stops a player who was already leading from firing a
 * spurious "you lost #1" at the runners-up when they merely extend their lead:
 * the prior leaders count only if they were at least tied for the lead
 * beforehand (actor wasn't already strictly ahead).
 */
export const decideLostTop = (
  bests: readonly BestRow[],
  actor: string,
  actorPrevBest: number | null,
): LostTopDecision => {
  const me = bests.find((b) => b.user === actor);
  if (!me) return NONE;
  const myNew = me.best;
  const myPrev = actorPrevBest ?? -Infinity;
  // This build didn't improve the actor's own best → it can't have moved the top.
  if (myNew <= myPrev) return NONE;

  const others = bests.filter((b) => b.user !== actor);
  if (others.length === 0) return NONE;
  const othersTop = Math.max(...others.map((b) => b.best));
  // The actor was already strictly ahead → the runners-up never held #1.
  if (othersTop < myPrev) return NONE;

  // A strict pass, or nothing: the actor must exceed the top to displace it (a
  // tie leaves the holders at the top).
  if (myNew <= othersTop) return NONE;

  // Passed the leader(s): each holder of the previous top drops off it.
  const holders = others.filter((b) => b.best === othersTop);
  return {
    passer: { name: me.name, time: myNew },
    recipients: holders.map((h) => ({ user: h.user, yourTime: h.best })),
  };
};

// Load the day's bests + the actor's prior best, decide, and notify. Awaited by
// the commit route (free play) and, gated on a build that leads the field, the
// update route (a ranked attempt's build can pass a PB just the same). Awaited
// because background work is unsafe on this Deploy. Never throws — a
// notification failure must not fail the run.
export const checkLostTop = async (iteration: number, actor: string) => {
  try {
    const [bests, prev, meta] = await Promise.all([
      getIterationBests(iteration),
      getUserPrevBest(actor, iteration),
      getStandingsMeta(iteration),
    ]);

    const decision = decideLostTop(
      bests.map((b) => ({
        user: b.user,
        name: b.name ?? "anonymous",
        best: b.best,
      })),
      actor,
      prev,
    );
    if (!decision.passer) return;

    const day: [number, number, number] = [meta.y, meta.m, meta.d];
    await Promise.all(
      decision.recipients.map((r) =>
        notifyLostTop(r.user, iteration, day, {
          passer: decision.passer!.name,
          passerTime: decision.passer!.time,
          yourTime: r.yourTime,
        })
      ),
    );
  } catch (err) {
    log.error("checkLostTop failed", err);
  }
};
