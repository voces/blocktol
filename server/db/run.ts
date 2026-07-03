import { Point } from "../../common/types.ts";
import { deserializeRun, serializeRun } from "../util/run.ts";
import { raw, sql } from "./query.ts";

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

export const updateCurrentRun = (
  user: string,
  time: number,
  blocks: (Point & { thunder?: boolean; player?: boolean })[],
  iteration: number,
) =>
  sql`
    UPDATE run
    SET time = ${time}, data = ${serializeRun(blocks)}, void = FALSE
    WHERE user = ${user}
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
