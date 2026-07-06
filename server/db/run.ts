import { Point } from "../../common/types.ts";
import { deserializeRun, serializeRun } from "../util/run.ts";
import { raw, sql } from "./query.ts";

// Every run starts void. A daily attempt counts once its maze is built
// (updateCurrentRun with commit = true); a free-play run counts only once it
// actually executes (commitRun). Navigating away before either leaves the run
// void — i.e. abandoned — so no explicit abandon call is needed for free play.
export const startRun = (
  iteration: number,
  user: string,
  minTime: number,
  year: number,
  month: number,
  day: number,
) =>
  sql`
    SELECT @isDaily1 := count(1) = 0
    FROM run
    WHERE user = ${user}
    AND iteration = ${iteration};

    SELECT @isDaily2 := id = ${iteration}
    FROM iteration
    WHERE YEAR(created) = ${year}
      AND MONTH(created) = ${month}
      AND DAY(created) = ${day};

    INSERT INTO run (user, iteration, time, data, void, daily)
    VALUES (${user}, ${iteration}, ${minTime}, '', TRUE, @isDaily1 AND @isDaily2);`;

// Abandon the user's current run on an iteration by voiding it, so it drops out
// of the panel and never counts toward best/standing. Constrained to
// daily = FALSE: this privilege is for free-play runs only — a spent daily
// attempt can't be erased. Targets the latest run (the one in progress); in free
// play that is always the non-daily one, since daily runs are the first three.
export const voidCurrentRun = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET void = TRUE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND daily = FALSE
    ORDER BY created DESC
    LIMIT 1;
  `;

// The mirror of voidCurrentRun: mark the caller's current free-play run non-void
// once it actually executes (timer expiry or an explicit start). Free-play runs
// are inserted void and only counted here, so leaving before the run runs keeps
// it void (abandoned). daily = FALSE scopes it to free play — daily attempts are
// already committed on build.
export const commitRun = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET void = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND daily = FALSE
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
// `commit` decides the void flag: a daily attempt commits immediately (its built
// maze is the spent attempt's result), so void is cleared and the ranked-three
// reassignment runs; a free-play run leaves void alone (it only counts once it
// executes — see commitRun) and skips the reassignment, which concerns only the
// ranked three and is meaningless for free play.
export const updateCurrentRun = (
  user: string,
  time: number,
  blocks: (Point & { thunder?: boolean; player?: boolean })[],
  iteration: number,
  commit = true,
) =>
  !commit
    ? sql`
    UPDATE run
    SET time = ${time}, data = ${serializeRun(blocks)}
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND TIMESTAMPDIFF(SECOND, created, NOW()) < 60
    ORDER BY created DESC LIMIT 1;`
    : sql`
    UPDATE run
    SET time = ${time}, data = ${serializeRun(blocks)}, void = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      and TIMESTAMPDIFF(SECOND, created, NOW()) < 60
    ORDER BY created DESC LIMIT 1;

    UPDATE run
    SET daily = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
      AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
      AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration})
    ORDER BY created ASC LIMIT 3;
    
    UPDATE run
    SET daily = TRUE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND time = (
        SELECT MAX(time)
        FROM (
          SELECT time
          FROM run
          WHERE user = ${user}
            AND iteration = ${iteration}
            AND YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
            AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
            AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration})
          ORDER BY created ASC LIMIT 3
        ) t1
      )
      AND iteration = (
        SELECT id
        FROM iteration
        WHERE YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
          AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
          AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration})
      )
    ORDER BY created ASC LIMIT 1;`;

export const getLatestRun = (
  user: string,
  iteration: number,
  dailyOnly?: boolean,
) =>
  sql<
    | { iteration: number; created: string; daily: number; data: string }[]
    | undefined
  >`
    SELECT iteration, created, daily, data
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      ${raw(dailyOnly ? "AND daily = TRUE" : "")}
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
