import { classifyDailyOutcome } from "../../common/notifications.ts";
import {
  getIterationDailyTimeCounts,
  getUnratedClosedIterations,
} from "../db/iteration.ts";
import { getIterationOutcomeField, getStandingsMeta } from "../db/standings.ts";
import { applyRatings, getRatingParticipants } from "../db/user.ts";
import { errText, log } from "./logging.ts";
import { selfExcludedPercentiles } from "./math.ts";
import { notifyDailyFinals } from "./notify.ts";
import { computeRatingChange } from "./rating.ts";

// Once a day is rated (its ranks locked), tell every player who made a ranked
// attempt how they finished — the five-way outcome from common/notifications.ts.
// Kept off the rating write's critical path and self-contained (notifyDailyFinals
// swallows its own errors), so a notification hiccup never blocks the sweep.
const notifyIterationFinal = async (iteration: number) => {
  try {
    const [players, meta] = await Promise.all([
      getIterationOutcomeField(iteration),
      getStandingsMeta(iteration),
    ]);
    const outcomes: {
      user: string;
      data: NonNullable<ReturnType<typeof classifyDailyOutcome>>;
    }[] = [];
    for (const p of players) {
      const data = classifyDailyOutcome(players, p.user);
      if (data) outcomes.push({ user: p.user, data });
    }
    await notifyDailyFinals(iteration, [meta.y, meta.m, meta.d], outcomes);
  } catch (err) {
    log.error("failed to notify daily final", {
      iteration,
      error: errText(err),
    });
  }
};

const rateIteration = async (iteration: number) => {
  const [field, participants] = await Promise.all([
    getIterationDailyTimeCounts(iteration),
    getRatingParticipants(iteration),
  ]);

  // One pass over the field gives every player's percentile (own run excluded).
  const percentiles = selfExcludedPercentiles(field);

  const updates: { user: string; rating: number; plays: number }[] = [];
  for (const p of participants) {
    const actual = percentiles.get(p.time);
    if (actual === undefined) continue; // only player that day — nothing to rank

    const change = computeRatingChange(p.rating, p.plays, actual);
    updates.push({
      user: p.user,
      rating: p.rating + change,
      plays: p.plays + 1,
    });
  }

  // Marks the iteration rated even when `updates` is empty, so it isn't rechecked.
  await applyRatings(iteration, updates);
  log.info("rated daily iteration", { iteration, players: updates.length });

  // The day is now final — notify its ranked players. After applyRatings so the
  // rating write is never held up by (or rolled back with) the notifications.
  await notifyIterationFinal(iteration);
};

const rateDailies = async () => {
  let iterations: number[];
  try {
    iterations = await getUnratedClosedIterations();
  } catch (err) {
    // e.g. the `rated` column not migrated in yet — degrade quietly.
    log.error("failed to list unrated iterations", { error: errText(err) });
    return;
  }
  for (const iteration of iterations) {
    try {
      await rateIteration(iteration);
    } catch (err) {
      log.error("failed to rate iteration", { iteration, error: errText(err) });
    }
  }
};

// Runs at :30 each hour (offset from the generation cron). `Deno.cron` is a
// single, non-overlapping writer, so no two isolates can double-rate. Each
// daily is rated once its date is fully closed across all timezones.
//
// DISABLE_CRONS gates registration (see gen.ts) so a second instance sharing
// this DB doesn't double-rate.
if (!Deno.env.get("DISABLE_CRONS")) {
  Deno.cron("rate-dailies", "30 * * * *", rateDailies);
}
