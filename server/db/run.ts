import { Point } from "../../common/types.ts";
import { deserializeRun, serializeRun } from "../util/run.ts";
import { raw, sql } from "./query.ts";

// Every run starts void. A daily attempt counts once its maze is built
// (updateCurrentRun clears void for ranked runs); a free-play run counts only
// once it actually executes (commitRun). Navigating away before either leaves
// the run void — i.e. abandoned — so no explicit abandon call is needed for
// free play.
//
// `ranked` — this run is one of the daily's three attempts — is recorded here
// and only here: among the user's first three runs on the iteration, AND the
// iteration is the daily for the user's claimed local day (year/month/day come
// from the request's timezone). It cannot be inferred later from `created`: a
// daily's legal window spans ~50 hours of server time (UTC+14 mornings through
// UTC-12 midnights), so only the start request knows. `daily` is a different
// flag — the single *counted* result — seeded on the first attempt and
// re-pointed at the best ranked run as builds save (see updateCurrentRun).
export const startRun = (
  iteration: number,
  user: string,
  minTime: number,
  year: number,
  month: number,
  day: number,
) =>
  sql`
    SET @priorRuns := NULL;
    SET @isDaily := FALSE;

    SELECT @priorRuns := COUNT(1)
    FROM run
    WHERE user = ${user}
    AND iteration = ${iteration};

    SELECT @isDaily := (id = ${iteration})
    FROM iteration
    WHERE YEAR(created) = ${year}
      AND MONTH(created) = ${month}
      AND DAY(created) = ${day}
    ORDER BY id LIMIT 1;

    INSERT INTO run (user, iteration, time, data, void, daily, ranked)
    VALUES (${user}, ${iteration}, ${minTime}, '', TRUE,
      (@priorRuns = 0) AND @isDaily,
      (@priorRuns < 3) AND @isDaily);`;

// Abandon the user's current run on an iteration by voiding it, so it drops out
// of the panel and never counts toward best/standing. Constrained to
// ranked = FALSE: this privilege is for free-play runs only — a spent daily
// attempt can't be erased. Targets the latest run (the one in progress).
export const voidCurrentRun = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET void = TRUE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND ranked = FALSE
    ORDER BY created DESC
    LIMIT 1;
  `;

// The mirror of voidCurrentRun: mark the caller's current free-play run non-void
// once it actually executes (timer expiry or an explicit start). Free-play runs
// are inserted void and only counted here, so leaving before the run runs keeps
// it void (abandoned). ranked = FALSE scopes it to free play — daily attempts
// are already committed on build.
export const commitRun = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET void = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND ranked = FALSE
    ORDER BY created DESC
    LIMIT 1;
  `;

export const getCurrentRun = (user: string) =>
  sql<{ iteration: number; created: string; time: number }[] | undefined>`
    SELECT iteration, created, time FROM run
    WHERE user = ${user}
    ORDER BY created DESC LIMIT 1`.then((r) =>
    r?.[0]
      ? {
        iteration: r[0].iteration,
        created: new Date(r[0].created),
        time: r[0].time,
      }
      : undefined
  );

// Save the caller's in-progress build (latest run, within the 60s window).
// Whether the save also commits comes off the run row itself: `ranked` was
// recorded at start (see startRun), the only moment the timezone-aware daily
// check can be made. A ranked attempt commits on build (its built maze is the
// spent attempt's result), clearing void and re-pointing `daily` — the single
// counted result — at the best ranked run; free play leaves void alone (it
// only counts once it executes — see commitRun) and skips the reassignment. A
// single multi-statement query runs on one connection, so @ranked is visible
// to every statement in the batch.
export const updateCurrentRun = (
  user: string,
  time: number,
  blocks: (Point & { thunder?: boolean; player?: boolean })[],
  iteration: number,
) =>
  sql`
    SET @ranked := FALSE;

    SELECT @ranked := ranked
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
    ORDER BY created DESC LIMIT 1;

    UPDATE run
    SET time = ${time}, data = ${
    serializeRun(blocks)
  }, void = void AND NOT @ranked
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND TIMESTAMPDIFF(SECOND, created, NOW()) < 60
    ORDER BY created DESC LIMIT 1;

    UPDATE run
    SET daily = FALSE
    WHERE @ranked
      AND user = ${user}
      AND iteration = ${iteration}
      AND ranked = TRUE;

    UPDATE run
    SET daily = TRUE
    WHERE @ranked
      AND user = ${user}
      AND iteration = ${iteration}
      AND ranked = TRUE
      AND time = (
        SELECT MAX(time)
        FROM (
          SELECT time
          FROM run
          WHERE user = ${user}
            AND iteration = ${iteration}
            AND ranked = TRUE
        ) t1
      )
    ORDER BY created ASC LIMIT 1;`;

// `rankedOnly` filters to the daily's three attempts — the resume path uses it
// to find an in-progress attempt. Filtering on `daily` here would be wrong: an
// in-progress attempt 2/3 only holds daily = TRUE while it happens to beat the
// earlier attempts (`daily` marks the counted result, not ranked-ness).
export const getLatestRun = (
  user: string,
  iteration: number,
  rankedOnly?: boolean,
) =>
  sql<
    | { iteration: number; created: string; daily: number; data: string }[]
    | undefined
  >`
    SELECT iteration, created, daily, data
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      ${raw(rankedOnly ? "AND ranked = TRUE" : "")}
    ORDER BY created DESC LIMIT 1;
  `.then((r) =>
    r?.[0]
      ? ({
        iteration: r[0].iteration,
        created: r[0].created,
        daily: !!r[0].daily,
        maze: deserializeRun(r[0].data),
      })
      : null
  );
