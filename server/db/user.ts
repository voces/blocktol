import { deserializeRun } from "../util/run.ts";
import { format, raw, sql } from "./query.ts";

type User = {
  id: string;
  name: string;
  rating: number;
};

export const getUser = (id: string) =>
  sql<(User | undefined)[]>`
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[0]);

export const createUser = (id: string, name: string) =>
  sql`
    INSERT INTO user (id, name) VALUES (${id}, ${name});
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then(() => getUser(id)!);

const createOrUpdateUserWithName = (id: string, name: string) =>
  sql<[unknown, User[]]>`
    INSERT INTO user (id, name) VALUES (${id}, ${name}) ON DUPLICATE KEY UPDATE name = ${name};
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0]);

export const createOrUpdateUser = (id: string, name?: string) =>
  name === undefined
    ? sql<[unknown, User[]]>`
    INSERT INTO user (id) VALUES (${id}) ON DUPLICATE KEY UPDATE id = id;
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0])
    : createOrUpdateUserWithName(id, name);

export const getUserPlays = (id: string) =>
  sql<({ count: number } | undefined)[]>`
    SELECT COUNT(1) count FROM run WHERE user = ${id} AND daily = TRUE;
  `.then((r) => r[0]?.count ?? 0);

export const updateUserName = (id: string, name: string) =>
  sql<[unknown, User[]]>`
    INSERT INTO user (id, name) VALUES (${id}, ${name}) ON DUPLICATE KEY UPDATE name = ${name};
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0]);

// The profile's headline figures, in one round trip:
//   1. the user's own row (display name, rating, join date);
//   2. dailies completed and their best-ever build (any run, daily or free);
//   3. the iteration of that best build (so the card can open it);
//   4. per-day ranked standings — the user's best daily time vs every OTHER
//      player's best daily time that day — from which the median percentile and
//      the count of days finished on top (100%) are derived.
// Only iterations the user actually played bound the ranking join, so it stays
// proportional to their history rather than the whole field.
export const getUserStats = async (user: string) => {
  const [userRows, totals, bestRows, ranks] = await sql<[
    { name: string | null; rating: number; joined: number }[],
    { played: number | null; bestBuild: number | null }[],
    { iteration: number }[],
    {
      iteration: number;
      less: number;
      equal: number;
      more: number;
      others: number;
    }[],
  ]>`
    SELECT name, rating, UNIX_TIMESTAMP(created) * 1000 joined
    FROM user WHERE id = ${user};

    SELECT
      COUNT(DISTINCT CASE WHEN daily = TRUE AND void = FALSE THEN iteration END) played,
      ROUND(MAX(CASE WHEN void = FALSE THEN time END), 2) bestBuild
    FROM run WHERE user = ${user};

    SELECT iteration
    FROM run
    WHERE user = ${user} AND void = FALSE
    ORDER BY time DESC, created ASC
    LIMIT 1;

    SELECT me.iteration iteration,
           SUM(CASE WHEN other.t < me.t THEN 1 ELSE 0 END) less,
           SUM(CASE WHEN other.t = me.t THEN 1 ELSE 0 END) equal,
           SUM(CASE WHEN other.t > me.t THEN 1 ELSE 0 END) more,
           COUNT(other.u) others
    FROM (
      SELECT iteration, MAX(time) t
      FROM run
      WHERE user = ${user} AND daily = TRUE AND void = FALSE
      GROUP BY iteration
    ) me
    LEFT JOIN (
      SELECT iteration, user u, MAX(time) t
      FROM run
      WHERE user != ${user} AND daily = TRUE AND void = FALSE
        AND iteration IN (
          SELECT iteration FROM run
          WHERE user = ${user} AND daily = TRUE AND void = FALSE
          GROUP BY iteration
        )
      GROUP BY iteration, user
    ) other ON other.iteration = me.iteration
    GROUP BY me.iteration;
  `;

  const u = userRows[0];

  // Ranked daily percentile per played day (self-excluded), mirroring the
  // calendar's per-day ranking: skip days nobody else played (no field to rank
  // against); a day nobody beat is a full 100% (a "1").
  const percentiles: number[] = [];
  let hundreds = 0;
  for (const r of ranks) {
    const others = Number(r.others);
    if (others === 0) continue;
    const pct = Number(r.more) === 0
      ? 1
      : (Number(r.less) + Number(r.equal) / 2) / others;
    percentiles.push(pct);
    if (pct === 1) hundreds++;
  }

  percentiles.sort((a, b) => a - b);
  const n = percentiles.length;
  const medianPercentile = n === 0
    ? null
    : n % 2 === 1
    ? percentiles[(n - 1) / 2]
    : (percentiles[n / 2 - 1] + percentiles[n / 2]) / 2;

  return {
    name: u?.name ?? null,
    rating: u?.rating ?? 1000,
    joined: u ? Number(u.joined) : null,
    played: Number(totals[0]?.played ?? 0),
    bestBuild: totals[0]?.bestBuild ?? null,
    bestBuildIteration: bestRows[0]?.iteration ?? null,
    hundreds,
    medianPercentile,
  };
};

// Counts a user's first 3 runs for an iteration, including abandoned (void)
// runs — starting a daily and not finishing it still costs an attempt, matching
// `dailyAttempts` (the timezone-based view).
export const dailyAttemptsByIteration = (user: string, iteration: number) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));

// The same first-3 attempts, but with the maze each run built — the ranked
// attempts (result modal, attempts-remaining).
export const attemptRunsByIteration = (user: string, iteration: number) =>
  sql<{ time: number; data: string; created: string }[]>`
    SELECT time, data, created
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) =>
    r.map((run) => ({
      time: run.time,
      maze: deserializeRun(run.data),
      created: new Date(run.created).getTime(),
    }))
  );

// Every non-void run on an iteration (the ranked three plus any free play),
// oldest first, each with its maze and creation time — the full runs list for
// the panel. Void (abandoned, never-submitted) runs are skipped so the panel
// isn't padded with empty rows.
export const allRunsByIteration = (user: string, iteration: number) =>
  sql<{ time: number; data: string; created: string }[]>`
    SELECT time, data, created
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND void = FALSE
    ORDER BY created ASC
    LIMIT 100;
  `.then((r) =>
    r.map((run) => ({
      time: run.time,
      maze: deserializeRun(run.data),
      created: new Date(run.created).getTime(),
    }))
  );

export const dailyAttempts = (
  user: string,
  year: number,
  month: number,
  day: number,
) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = (
        SELECT id
        FROM iteration
        WHERE YEAR(created) = ${year}
          AND MONTH(created) = ${month}
          AND DAY(created) = ${day}
        LIMIT 1
      )
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = ([y, m, d]: [number, number, number]) =>
  `${y}-${pad(m)}-${pad(d)}`;

export const listDailies = async (
  user: string,
  opts: {
    start?: [number, number, number];
    end?: [number, number, number];
    limit?: number;
  } = {},
) => {
  // Default window: the current (UTC) month — a daily's date is its UTC creation
  // date, so this is the natural "recent" slice for load/refresh. Callers page
  // further back by passing explicit start/end day ranges.
  let { start, end } = opts;
  if (!start && !end) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    start = [y, m + 1, 1];
    end = m === 11 ? [y + 1, 1, 1] : [y, m + 2, 1];
  }
  // Safety cap on a single request (a month is ~31 rows); the range does the
  // real bounding.
  const limit = opts.limit ?? 400;

  const bounds = [
    start ? format`AND iteration.created >= ${dateStr(start)}` : "",
    end ? format`AND iteration.created < ${dateStr(end)}` : "",
  ].join(" ");

  // The page of iterations both statements below cover: the user's played days
  // within the window. Built once and inlined into each so the whole list is a
  // single round trip. Wrapped in a derived table because MySQL won't accept a
  // LIMIT directly inside an IN (...) subquery.
  const page = raw(format`(
    SELECT id FROM (
      SELECT id
      FROM iteration
      WHERE id <= (SELECT MAX(iteration) FROM run WHERE user = ${user})
        ${raw(bounds)}
      ORDER BY id DESC
      LIMIT ${limit}
    ) page
  )`);

  // Two statements, one round trip: the per-day aggregates, then the pieces of
  // each day's ranked-daily percentile — the user's best daily attempt against
  // every other player's best daily attempt, each player first reduced to their
  // single best. The percentile needs the whole field's distribution, so it
  // can't fold into the GROUP BY above.
  const [rows, ranks, firstRows] = await sql<[
    {
      iteration: number;
      created: number;
      ownBest: number | null;
      ownDailyBest: number | null;
      otherBest: number | null;
      best: number | null;
      dailyBest: number | null;
      min: number;
    }[],
    {
      iteration: number;
      less: number;
      equal: number;
      more: number;
      others: number;
    }[],
    { created: number }[],
  ]>`
  SELECT
    id iteration,
    iteration.created created,
    ROUND(MAX(CASE WHEN user = ${user} THEN time ELSE null END), 2) ownBest,
    ROUND(MAX(CASE WHEN user = ${user} AND daily = TRUE THEN time ELSE null END), 2) ownDailyBest,
    ROUND(MAX(CASE WHEN user != ${user} THEN time ELSE null END), 2) otherBest,
    MAX(time) best,
    ROUND(MAX(CASE WHEN daily = TRUE THEN time ELSE null END), 2) dailyBest,
    min
  FROM iteration
  LEFT JOIN run ON iteration.id = run.iteration
  WHERE id IN ${page}
  GROUP BY 1
  ORDER BY id DESC;

  SELECT me.iteration iteration,
         SUM(CASE WHEN other.t < me.t THEN 1 ELSE 0 END) less,
         SUM(CASE WHEN other.t = me.t THEN 1 ELSE 0 END) equal,
         SUM(CASE WHEN other.t > me.t THEN 1 ELSE 0 END) more,
         COUNT(other.u) others
  FROM (
    SELECT iteration, MAX(time) t
    FROM run
    WHERE user = ${user} AND daily = TRUE AND void = FALSE AND iteration IN ${page}
    GROUP BY iteration
  ) me
  LEFT JOIN (
    SELECT iteration, user u, MAX(time) t
    FROM run
    WHERE user != ${user} AND daily = TRUE AND void = FALSE AND iteration IN ${page}
    GROUP BY iteration, user
  ) other ON other.iteration = me.iteration
  GROUP BY me.iteration;

  SELECT created FROM iteration ORDER BY id ASC LIMIT 1;`;

  const rankByIter = new Map(ranks.map((r) => [r.iteration, r]));

  // The very first daily's date — the floor the calendar can page back to,
  // independent of which months the user actually played (so gaps don't stop
  // paging short of real history).
  const firstCreated = firstRows[0]?.created;
  const oldest: [number, number, number] | null = firstCreated == null
    ? null
    : [
      new Date(firstCreated).getUTCFullYear(),
      new Date(firstCreated).getUTCMonth() + 1,
      new Date(firstCreated).getUTCDate(),
    ];

  const items = rows.map((
    r,
  ): {
    iteration: number;
    daily: [number, number, number];
    ownDailyBest: number | null;
    ownBest: number | null;
    best: number | null;
    dailyBest: number | null;
    min: number;
    supreme: boolean;
    // 0..1 percentile of the user's best daily attempt vs other players' best
    // daily attempts; p100 (1) means they equalled or bettered everyone. null
    // when there's no ranking to make (no daily attempt, or no other players).
    dailyPercentile: number | null;
  } => {
    const rank = rankByIter.get(r.iteration);
    const others = rank ? Number(rank.others) : 0;
    const dailyPercentile = !rank || others === 0
      ? null
      : Number(rank.more) === 0
      ? 1
      : (Number(rank.less) + Number(rank.equal) / 2) / others;
    return {
      iteration: r.iteration,
      daily: [
        new Date(r.created).getUTCFullYear(),
        new Date(r.created).getUTCMonth() + 1,
        new Date(r.created).getUTCDate(),
      ],
      ownDailyBest: r.ownDailyBest,
      ownBest: r.ownBest,
      best: r.best,
      dailyBest: r.dailyBest,
      min: r.min,
      supreme: typeof r.ownBest === "number"
        ? typeof r.otherBest === "number" ? r.ownBest > r.otherBest : true
        : false,
      dailyPercentile,
    };
  });

  return { items, oldest };
};

export const getOwnBest = (user: string, iteration: number) =>
  sql<{ ownBest: number }[] | null>`
    SELECT max(time) ownBest
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration};`.then((r) => r?.[0].ownBest ?? null);

export const getOwnBestMaze = (user: string, iteration: number) =>
  sql<({ data: string | null } | null)[] | null>`
    SELECT data
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND LENGTH(DATA) > 0
      AND time = (
        SELECT max(time)
        FROM run
        WHERE user = ${user}
        AND iteration = ${iteration}
      )
    LIMIT 1;`.then((r) => r?.[0]?.data ? deserializeRun(r[0].data) : null);

export const updateRating = (user: string, rating: number) =>
  sql`UPDATE user SET rating = ${rating} WHERE id = ${user};`;

// Each completer of an iteration's daily, with their best time and current
// rating/plays. Abandoners (no completed run) are excluded — they already lose
// an attempt; they aren't rated.
export const getRatingParticipants = (iteration: number) =>
  sql<{ user: string; time: number; rating: number; plays: number }[]>`
    SELECT r.user, MAX(r.time) time,
           COALESCE(u.rating, 1000) rating, COALESCE(u.plays, 0) plays
    FROM run r
    JOIN user u ON u.id = r.user
    WHERE r.iteration = ${iteration}
      AND r.daily = TRUE
      AND r.void = FALSE
    GROUP BY r.user, u.rating, u.plays;
  `;

// Apply a batch of rating updates and mark the iteration rated, in one
// transaction so a partial failure can't double- or under-count. The updates
// are a single bulk upsert (one statement, one parse) rather than one UPDATE
// per player, so it scales to thousands of participants.
export const applyRatings = (
  iteration: number,
  updates: { user: string; rating: number; plays: number }[],
) => {
  const upsert = updates.length === 0 ? "" : format`
    INSERT INTO user (id, rating, plays)
    VALUES ${updates.map((u) => [u.user, u.rating, u.plays])}
    ON DUPLICATE KEY UPDATE rating = VALUES(rating), plays = VALUES(plays);
  `;
  return sql`
    START TRANSACTION;
    ${raw(upsert)}
    UPDATE iteration SET rated = TRUE WHERE id = ${iteration};
    COMMIT;
  `;
};
