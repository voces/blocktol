import {
  getIterationDailyTimeCounts,
  getUnratedClosedIterations,
} from "../db/iteration.ts";
import { applyRatings, getRatingParticipants } from "../db/user.ts";
import { log } from "./logging.ts";
import { percentileFromTimeCounts } from "./math.ts";
import { computeRatingChange } from "./rating.ts";

const rateIteration = async (iteration: number) => {
  const [field, participants] = await Promise.all([
    getIterationDailyTimeCounts(iteration),
    getRatingParticipants(iteration),
  ]);

  const updates: { user: string; rating: number; plays: number }[] = [];
  for (const p of participants) {
    // Rank the player against the field with their own run removed.
    const counts = field
      .map((c) => c.time === p.time ? { time: c.time, count: c.count - 1 } : c)
      .filter((c) => c.count > 0);
    const actual = percentileFromTimeCounts(counts, p.time);
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
  log.info("rated daily iteration", iteration, `(${updates.length} players)`);
};

const rateDailies = async () => {
  let iterations: number[];
  try {
    iterations = await getUnratedClosedIterations();
  } catch (err) {
    // e.g. the `rated` column not migrated in yet — degrade quietly.
    log.error("failed to list unrated iterations", err);
    return;
  }
  for (const iteration of iterations) {
    try {
      await rateIteration(iteration);
    } catch (err) {
      log.error("failed to rate iteration", iteration, err);
    }
  }
};

// Runs at :30 each hour (offset from the generation cron). `Deno.cron` is a
// single, non-overlapping writer, so no two isolates can double-rate. Each
// daily is rated once its date is fully closed across all timezones.
Deno.cron("rate-dailies", "30 * * * *", rateDailies);
