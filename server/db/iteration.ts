import type { Point } from "../../common/types.ts";
import { memoize } from "../util/memoize.ts";
import { NotFoundError } from "../util/UserError.ts";
import { type ExecResult, format, raw, sql, sqlOnce } from "./query.ts";

const pad = (n: number) => String(n).padStart(2, "0");

export const getIterationCount = () =>
  sql<{ count: number }[]>`
    SELECT COUNT(*) count FROM iteration;
  `.then(([r]) => r?.count ?? 0);

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
    // A client-supplied id (getBoard, standings, …): a 404, not a 500 + error
    // log. The rejection isn't memoized (memoize evicts it).
    if (!i) throw new NotFoundError(`Iteration ${id} does not exist`);

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
  // `created` is a DATE (migration v14). Bind an explicit `YYYY-MM-DD` rather
  // than a JS Date so the stored day is the same across transports; it uses the
  // local components getDailyIterationId and the gen cron look the day up by.
  const created = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${
    pad(date.getDate())
  }`;
  // sqlOnce: ensureDailyIterationId reads a failed INSERT (UNIQUE(created)) as
  // "someone else generated it" and re-reads, so a retry must not fire a second
  // write for it to reconcile.
  //
  // One transaction: the iteration row and its fixed blocks land together or
  // not at all. A day row without pieces would never be repaired, since
  // generators check only that the row exists. In a race the loser's iteration
  // INSERT blocks on the winner's uncommitted row, then fails with the
  // duplicate-key error that ensureDailyIterationId catches. The direct
  // transport rolls back a batch that fails mid-transaction
  // (directTransport.ts).
  return sqlOnce<[ExecResult, ExecResult, ...unknown[]]>`
    START TRANSACTION;
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
  }
    COMMIT;`.then(([, q]) => q.insertId);
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

// The earliest day any iteration exists for, as UTC-midnight epoch ms (null on
// an empty table) — the on-demand backfill's lower bound (util/backfillWindow).
// Read as Y/M/D numbers rather than the DATE itself so the result doesn't
// depend on how a transport serialises a DATE.
export const getEarliestIterationDay = () =>
  sql<{ y: number | null; m: number | null; d: number | null }[]>`
    SELECT YEAR(MIN(created)) y, MONTH(MIN(created)) m, DAY(MIN(created)) d
    FROM iteration`.then(([r]) =>
    r?.y == null || r.m == null || r.d == null
      ? null
      : Date.UTC(r.y, r.m - 1, r.d)
  );

export const getDailyIteration = (year: number, month: number, day: number) =>
  getDailyIterationId(year, month, day).then((id) =>
    id ? getIteration(id) : undefined
  );

// The best build among OTHER players on an iteration. Void runs are excluded,
// as in every board/standings query (getIterationBests, getDailyStandings,
// listDailies, the profile's bestBuild): a void row is not a build. A ranked
// attempt that was started but never built is void and carries the iteration's
// min as its time (startRun), and so does a legacy free-play row that was never
// committed (commitRun). Counting either would inflate the "best to beat",
// block the supreme cue, or suppress a genuine lost-top pass. Feeds the board
// target, attempts panel, run start, daily summary, the supreme flag, and the
// lost-top gate.
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
  `.then(([r]) => r?.otherBest ?? null);

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

// How many closed dailies are still unrated `hours` after the fact, and the
// oldest one's date — the rate-dailies liveness probe (util/gen.ts). Same
// close predicate as getUnratedClosedIterations, with a larger offset.
export const getStaleUnratedIterations = (hours: number) =>
  sql<{ count: number; oldest: string | null }[]>`
    SELECT COUNT(*) count, MIN(created) oldest
    FROM iteration
    WHERE rated = FALSE
      AND DATE(created) <= DATE(NOW() - INTERVAL ${hours} HOUR);
  `.then((r) => ({
    count: Number(r[0]?.count ?? 0),
    oldest: r[0]?.oldest ?? null,
  }));

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

// Whether today's (UTC) puzzle exists: the health check's database probe. The
// gen cron builds a day ahead, so a miss means generation has been failing for
// a while, not just a race at midnight.
export const hasTodaysIteration = () =>
  sql<{ ok: number }[]>`
    SELECT 1 ok FROM iteration WHERE created = UTC_DATE() LIMIT 1;
  `.then((rows) => rows.length > 0);
