import { classifyDailyOutcome } from "../../common/notifications.ts";
import {
  getIterationDailyTimeCounts,
  getUnratedClosedIterations,
} from "../db/iteration.ts";
import { getIterationOutcomeField, getStandingsMeta } from "../db/standings.ts";
import { applyRatings, getRatingParticipants } from "../db/user.ts";
import { alertAdmin } from "./adminAlert.ts";
import { announceDailyResult } from "./dailyAnnounce.ts";
import { errText, log } from "./logging.ts";
import { selfExcludedPercentiles } from "./math.ts";
import { notifyDailyFinals } from "./notify.ts";
import { computeRatingChange } from "./rating.ts";
import { schedule } from "./cron.ts";

// Once a day is rated, tell every ranked player how they finished (the five-way
// outcome from common/notifications.ts). Swallows its own errors so a
// notification failure never blocks the sweep.
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

  // One pass gives every time's percentile with the player's own run excluded.
  const percentiles = selfExcludedPercentiles(field);

  const deltas: { user: string; delta: number }[] = [];
  for (const p of participants) {
    const actual = percentiles.get(p.time);
    if (actual === undefined) continue; // only player that day — nothing to rank

    deltas.push({
      user: p.user,
      delta: computeRatingChange(p.rating, p.plays, actual),
    });
  }

  // Claims the iteration (marked rated even when `deltas` is empty, so it isn't
  // rechecked) and applies the deltas only if the claim was ours. If another
  // writer rated it since we listed it, nothing is applied and its
  // notifications/posts are that writer's to send.
  if (!await applyRatings(iteration, deltas)) {
    log.info("daily iteration already rated elsewhere; skipping", {
      iteration,
    });
    return;
  }
  log.info("rated daily iteration", { iteration, players: deltas.length });

  // After applyRatings so the rating write is neither held up by nor rolled
  // back with these. Both swallow their own errors, so they run together.
  await Promise.all([
    notifyIterationFinal(iteration),
    announceDailyResult(iteration),
  ]);
};

const rateDailies = async () => {
  let iterations: number[];
  try {
    iterations = await getUnratedClosedIterations();
  } catch (err) {
    // Degrade quietly (e.g. a migration not yet applied); the next run retries.
    log.error("failed to list unrated iterations", { error: errText(err) });
    return;
  }
  for (const iteration of iterations) {
    try {
      await rateIteration(iteration);
    } catch (err) {
      log.error("failed to rate iteration", { iteration, error: errText(err) });
      // A closed day we can't rate is stuck until an operator intervenes (no
      // ELO, no daily-final notifications), so alert. The list-fetch failure
      // above stays quiet: the next run heals it.
      alertAdmin(`rate-dailies: failed to rate iteration ${iteration}`);
    }
  }
};

// Runs at :30 each hour (offset from the generation cron). Each daily is rated
// once its date is closed in all timezones.
//
// `schedule` is non-overlapping only within ONE instance. DISABLE_CRONS (see
// gen.ts) normally keeps a second instance off, but correctness doesn't rest
// on it: applyRatings claims each day atomically, so a forgotten flag costs
// duplicate work, never a double rating or announcement.
if (!Deno.env.get("DISABLE_CRONS")) {
  schedule("rate-dailies", "30 * * * *", rateDailies);
}
