import { Point } from "../../common/types.ts";
import { memoize } from "../util/memoize.ts";
import { ExecResult, format, raw, sql, sqlOnce } from "./query.ts";

const pad = (n: number) => String(n).padStart(2, "0");

export const getIterationCount = () =>
  sql<{ count: number }[]>`
    SELECT COUNT(*) count FROM iteration;
  `.then((r) => r[0].count);

export const getIteration = memoize((id: number) =>
  sql<
    [
      {
        id: number;
        bricks: number;
        created: string;
        power: number;
        checkpoint_x: number;
        checkpoint_y: number;
        min: number;
      }[],
      { x: number; y: number; kind: "block" | "thunder" }[],
    ]
  >`
    SELECT id, bricks, created, power, checkpoint_x, checkpoint_y, min FROM iteration WHERE id = ${id};
    SELECT x, y, kind FROM block WHERE iteration = ${id};
  `.then(([[i], blocks]) => {
    if (!i) throw new Error(`Iteration ${id} does not exist`);

    return ({
      iteration: i.id,
      date: i.created,
      bricks: i.bricks,
      power: i.power,
      checkpoint: { x: i.checkpoint_x, y: i.checkpoint_y },
      blocks: blocks.map(({ x, y, kind }) => ({
        x,
        y,
        thunder: kind === "thunder",
      })),
      min: i.min,
    });
  })
);

export const createIteration = (
  date: Date,
  bricks: number,
  power: number,
  checkpoint: Point,
  blocks: Point[],
  thunders: Point[],
  duration: number,
) => {
  // `created` is a DATE (a puzzle is for a calendar day, not an instant — see
  // migration v14). Bind an explicit `YYYY-MM-DD` rather than a JS Date so the
  // stored day is unambiguous across transports, derived from the same local
  // components getDailyIterationId / the gen cron look the day up by.
  const created = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${
    pad(date.getDate())
  }`;
  // sqlOnce: a retry after a lost response would attempt a duplicate INSERT for
  // the day. The UNIQUE(created) key makes that a hard error rather than a
  // duplicate row, but the caller (ensureDailyIterationId) treats a losing
  // INSERT as "someone else generated it" and re-reads, so a retry here must not
  // fire a second write it would then have to reconcile.
  return sqlOnce<[ExecResult, ExecResult, ExecResult[] | undefined]>`
    INSERT INTO iteration (created, bricks, power, checkpoint_x, checkpoint_y, min)
    VALUES (${created}, ${bricks}, ${power}, ${checkpoint.x}, ${checkpoint.y}, ${duration});
    SET @last_id = LAST_INSERT_ID();
    ${
    raw(format`
      INSERT INTO block (iteration, x, y, kind)
      VALUES ${[
      ...blocks.map((b) => [raw`@last_id`, b.x, b.y, "block"]),
      ...thunders.map((t) => [raw`@last_id`, t.x, t.y, "thunder"]),
    ]};`)
  }`.then(([q]) => q.insertId);
};

export const getMaxIterationTime = (iteration: number) =>
  sql<{ max: number }[] | undefined>`
    SELECT MAX(time) max FROM run WHERE iteration = ${iteration};
  `.then((r) => r?.[0]?.max);

export const getIterationTimeCounts = (
  iteration: number,
  user: string,
  dailyOnly = true,
) =>
  sql<{ time: number; count: number }[]>`
      SELECT time, COUNT(1) count
      FROM run
      WHERE iteration = ${iteration}
        AND daily = ${dailyOnly}
        AND void = FALSE
        AND user != ${user}
      GROUP BY 1
      ORDER BY time;`;

export const getDailyIterationId = (year: number, month: number, day: number) =>
  sql<{ id: number }[]>`
    SELECT id
    FROM iteration
    WHERE YEAR(created) = ${year}
      AND MONTH(created) = ${month}
      AND DAY(created) = ${day}
    ORDER BY id
    LIMIT 1`.then((r) => r[0]?.id);

export const getDailyIteration = (year: number, month: number, day: number) =>
  getDailyIterationId(year, month, day).then((id) =>
    id ? getIteration(id) : undefined
  );

// The best build among OTHER players on an iteration — void (abandoned) runs
// excluded, matching every board/standings query (getIterationBests,
// getDailyStandings, listDailies, the profile's bestBuild). A void run is
// invisible everywhere else, so counting it here would let an abandoned free-
// play maze inflate the "best to beat", block the supreme cue, or (before this)
// suppress a genuine lost-top pass. Feeds the board target, attempts panel, run
// start, daily summary, the supreme flag, and the lost-top gate.
export const getIterationOtherBest = (
  iteration: number,
  user: string,
  daily = false,
) =>
  sql<{ otherBest: number | null }[]>`
    SELECT MAX(time) otherBest
    FROM run
    WHERE iteration = ${iteration}
      AND user != ${user}
      AND void = FALSE
      ${daily ? raw`AND daily = true` : raw("")}
  `.then((r) => r[0].otherBest);

// Dailies whose date is fully past for every timezone (so the field is frozen)
// and that haven't been rated yet. 37h = the UTC-12 close (D+1 12:00 UTC) plus
// a 1h pad for in-flight submissions and hourly-cron granularity.
export const getUnratedClosedIterations = (hours = 37) =>
  sql<{ id: number }[]>`
    SELECT id
    FROM iteration
    WHERE rated = FALSE
      AND DATE(created) <= DATE(NOW() - INTERVAL ${hours} HOUR)
    ORDER BY created, id
    LIMIT 25;
  `.then((r) => r.map((i) => i.id));

// The completed daily times for an iteration (one per player), used as the
// field a player's percentile is computed against.
export const getIterationDailyTimeCounts = (iteration: number) =>
  sql<{ time: number; count: number }[]>`
    SELECT time, COUNT(1) count
    FROM run
    WHERE iteration = ${iteration}
      AND daily = TRUE
      AND void = FALSE
    GROUP BY time
    ORDER BY time;
  `;
