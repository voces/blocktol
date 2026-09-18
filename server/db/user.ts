import { avatarHue } from "../../common/avatar.ts";
import { randomName } from "../../common/random/name.ts";
import { parseSettings } from "../../common/settings.ts";
import { alertAdmin } from "../util/adminAlert.ts";
import { hashUserId } from "../util/hashUserId.ts";
import { log } from "../util/logging.ts";
import { deserializeRun } from "../util/run.ts";
import { streaks } from "../util/streak.ts";
import { format, raw, sql } from "./query.ts";

// The most runs the attempts panel loads for one player on one iteration. High
// enough that no real player is ever truncated (a heavy free-play replayer sits
// in the low hundreds), but a hard ceiling so a runaway client can't ask us to
// serialize an unbounded maze list. Hitting it means the panel is now dropping
// that player's oldest runs — a human-actionable oddity, so alert once (see
// below).
const RUN_CAP = 10_000;
// Dedup the cap alert to once per (user, iteration) per process — the read
// fires on every board load, and we want one ping, not one per refresh.
const capAlerted = new Set<string>();

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
    // Seed a random display name on first insert, and backfill it onto any
    // existing user still lacking one (COALESCE keeps a chosen name untouched).
    ? sql<[unknown, User[]]>`
    INSERT INTO user (id, name) VALUES (${id}, ${randomName()})
      ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name));
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0])
    : createOrUpdateUserWithName(id, name);

export const updateUserName = (id: string, name: string) =>
  sql<[unknown, User[]]>`
    INSERT INTO user (id, name) VALUES (${id}, ${name}) ON DUPLICATE KEY UPDATE name = ${name};
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0]);

// The user's persisted preferences, tolerant of legacy/absent blobs.
export const getUserSettings = (id: string) =>
  sql<{ settings: string | null }[]>`
    SELECT settings FROM user WHERE id = ${id};
  `.then((r) => parseSettings(r[0]?.settings ?? null));

// Upsert so it never no-ops for a user whose row hasn't been seeded yet (a later
// createOrUpdateUser backfills the name via COALESCE).
export const updateUserSettings = (id: string, settings: string) =>
  sql`
    INSERT INTO user (id, settings) VALUES (${id}, ${settings})
    ON DUPLICATE KEY UPDATE settings = ${settings};`;

// The user's BCP-47 locale, captured passively (a subscribing device reports it)
// so server-rendered push copy can match it. Upsert like updateUserSettings; the
// caller only passes a canonicalised, non-null tag, so this never clobbers a
// known locale with a bad one.
export const updateUserLocale = (id: string, locale: string) =>
  sql`
    INSERT INTO user (id, locale) VALUES (${id}, ${locale})
    ON DUPLICATE KEY UPDATE locale = ${locale};`;

// The profile's stats, in one round trip. Every figure is derived from the runs
// already stored — nothing here needs a new column:
//   1. the user's own row (display name, rating, join date, settings);
//   2. RANKED, over closed (rated) days with a field: the days they took the top
//      time alone or shared, and how many such days there were (the win rate's
//      denominator). A day nobody else played is skipped — there is no field to
//      win — the same rule the calendar's per-day ranking uses;
//   3. SOLVES: days where a ranked attempt equalled the best build anyone has
//      made on that board, and the subset where the FIRST attempt did. The bar
//      is the board's current best, free play included, so a solve is lost again
//      if someone later builds longer — it means "nobody has ever done better",
//      not "best on the day";
//   4. FREE PLAY: boards where their best build is the board's top, alone
//      (supreme) or shared (record), boards played, and how many boards exist;
//   5. the dates they made ranked attempts on, for the streak (computed in
//      server/util/streak.ts);
//   6. HEAD-TO-HEAD per rival, on both boards: ranked days both played, and
//      boards both built on. Rows ship `name` + `hue`, never the rival's id —
//      the raw id is the bearer credential (see common/avatar.ts).
// Each half of a comparison is a per-iteration MAX over the same `time` column,
// so equality is exact: the two sides read the identical stored value.
export const getUserStats = async (user: string) => {
  const [userRows, ranked, solves, boards, total, days, daily, pb] = await sql<[
    {
      name: string | null;
      rating: number;
      joined: number;
      settings: string | null;
    }[],
    { days: number; sole: number; shared: number }[],
    { solved: number; firstTry: number }[],
    { supremes: number; records: number; played: number }[],
    { boards: number; today: string }[],
    { day: string }[],
    RivalRow[],
    RivalRow[],
  ]>`
    SELECT name, rating, UNIX_TIMESTAMP(created) * 1000 joined, settings
    FROM user WHERE id = ${user};

    SELECT COUNT(*) days,
           SUM(CASE WHEN mine > others THEN 1 ELSE 0 END) sole,
           SUM(CASE WHEN mine = others THEN 1 ELSE 0 END) shared
    FROM (
      SELECT MAX(CASE WHEN r.user = ${user} THEN r.time END) mine,
             MAX(CASE WHEN r.user != ${user} THEN r.time END) others
      FROM iteration i
      JOIN run r ON r.iteration = i.id AND r.ranked = TRUE AND r.void = FALSE
      WHERE i.rated = TRUE
      GROUP BY i.id
      HAVING mine IS NOT NULL AND others IS NOT NULL
    ) field;

    SELECT SUM(CASE WHEN mine.best = top.best THEN 1 ELSE 0 END) solved,
           SUM(CASE WHEN mine.first = top.best THEN 1 ELSE 0 END) firstTry
    FROM (
      SELECT iteration, MAX(time) best, MAX(CASE WHEN rn = 1 THEN time END) first
      FROM (
        SELECT iteration, time,
               ROW_NUMBER() OVER (PARTITION BY iteration ORDER BY created) rn
        FROM run
        WHERE user = ${user} AND ranked = TRUE AND void = FALSE
      ) attempts
      GROUP BY iteration
    ) mine
    JOIN (
      SELECT iteration, MAX(time) best FROM run WHERE void = FALSE
      GROUP BY iteration
    ) top ON top.iteration = mine.iteration;

    SELECT
      SUM(CASE WHEN others.best IS NULL OR mine.best > others.best THEN 1 ELSE 0 END) supremes,
      SUM(CASE WHEN mine.best = others.best THEN 1 ELSE 0 END) records,
      COUNT(*) played
    FROM (
      SELECT iteration, MAX(time) best FROM run
      WHERE user = ${user} AND void = FALSE GROUP BY iteration
    ) mine
    LEFT JOIN (
      SELECT iteration, MAX(time) best FROM run
      WHERE user != ${user} AND void = FALSE GROUP BY iteration
    ) others ON others.iteration = mine.iteration;

    SELECT COUNT(*) boards, CAST(CURDATE() AS char) today
    FROM iteration WHERE created <= CURDATE();

    SELECT DISTINCT CAST(i.created AS char) day
    FROM run r JOIN iteration i ON i.id = r.iteration
    WHERE r.user = ${user} AND r.ranked = TRUE AND r.void = FALSE;

    ${raw(rivals(user, "AND r.ranked = TRUE"))};

    ${raw(rivals(user, ""))};
  `;

  const u = userRows[0];
  const allRivals = mergeRivals(daily, pb);
  const { current, best } = streaks(
    days.map((d) => String(d.day).slice(0, 10)),
    String(total[0]?.today ?? "").slice(0, 10),
  );

  return {
    name: u?.name ?? null,
    rating: u?.rating ?? 1000,
    joined: u ? Number(u.joined) : null,
    settings: parseSettings(u?.settings ?? null),
    // Ranked
    rankedDays: Number(ranked[0]?.days ?? 0),
    wonSole: Number(ranked[0]?.sole ?? 0),
    wonShared: Number(ranked[0]?.shared ?? 0),
    daysPlayed: days.length,
    streak: current,
    bestStreak: best,
    solved: Number(solves[0]?.solved ?? 0),
    solvedFirstTry: Number(solves[0]?.firstTry ?? 0),
    // Free play
    supremes: Number(boards[0]?.supremes ?? 0),
    records: Number(boards[0]?.records ?? 0),
    boardsPlayed: Number(boards[0]?.played ?? 0),
    boards: Number(total[0]?.boards ?? 0),
    // Head-to-head: enough rivals for the profile's own list, plus the total
    // so it can offer the rest. The full list is its own call (getUserRivals),
    // fetched when the player opens it rather than on every boot.
    rivals: allRivals.slice(0, RIVAL_PREVIEW),
    rivalCount: allRivals.length,
  };
};

type RivalRow = {
  user: string;
  name: string | null;
  met: number;
  won: number;
  lost: number;
  tied: number;
};

// A rival's record on one board: the viewer's best time per iteration against
// every other player's, over the iterations they both ran. `rankedOnly` narrows
// both sides to ranked attempts (the daily board); empty counts every non-void
// run (the PB board). Written as SQL text so the two boards are one query each
// with no duplicated shape.
const rivals = (user: string, rankedOnly: string) =>
  format`
    SELECT o.user user, u.name name, COUNT(*) met,
           SUM(CASE WHEN m.t > o.t THEN 1 ELSE 0 END) won,
           SUM(CASE WHEN m.t < o.t THEN 1 ELSE 0 END) lost,
           SUM(CASE WHEN m.t = o.t THEN 1 ELSE 0 END) tied
    FROM (
      SELECT iteration, MAX(time) t FROM run r
      WHERE r.user = ${user} AND r.void = FALSE ${raw(rankedOnly)}
      GROUP BY iteration
    ) m
    JOIN (
      SELECT iteration, user, MAX(time) t FROM run r
      WHERE r.user != ${user} AND r.void = FALSE ${raw(rankedOnly)}
      GROUP BY iteration, user
    ) o ON o.iteration = m.iteration
    JOIN user u ON u.id = o.user
    GROUP BY o.user, u.name
    ORDER BY met DESC
    LIMIT ${RIVAL_CAP}`;

// A pair needs this many meetings on a board before that board's record
// appears: a 1–0 from a single shared day is noise, not a rivalry.
const RIVAL_MINIMUM = 5;
// Rows sent for the profile's own list, most-met first, with a way into the
// rest. Five is what the desktop dialog's two-column layout fits beside the
// settings column; stacked, the client shows one fewer (see Profile.tsx) — it
// slices rather than the CSS hiding a row, so a player with exactly five rivals
// still gets a "see all" into the fifth.
const RIVAL_PREVIEW = 5;
// Ceiling on one query's rows. Comfortably past any real heat today, and the
// list is one grouped pass over the viewer's own runs either way — the point is
// that a runaway field can't make the profile response unbounded.
const RIVAL_CAP = 500;

// One row per rival carrying both boards, with the id hashed to its avatar hue
// on the way out. A rival appears if EITHER board has enough meetings; the
// board that doesn't reach the minimum comes back null and the client shows a
// dash for it.
const mergeRivals = (daily: RivalRow[], pb: RivalRow[]) => {
  const record = (r: RivalRow | undefined) =>
    r && Number(r.met) >= RIVAL_MINIMUM
      ? {
        met: Number(r.met),
        won: Number(r.won),
        lost: Number(r.lost),
        tied: Number(r.tied),
      }
      : null;
  const byUser = new Map<string, { name: string | null }>();
  for (const r of [...daily, ...pb]) byUser.set(r.user, { name: r.name });
  const dailyBy = new Map(daily.map((r) => [r.user, r]));
  const pbBy = new Map(pb.map((r) => [r.user, r]));

  return [...byUser]
    .map(([id, { name }]) => ({
      name: name ?? "anonymous",
      hue: avatarHue(id),
      daily: record(dailyBy.get(id)),
      pb: record(pbBy.get(id)),
    }))
    .filter((r) => r.daily || r.pb)
    .sort((a, b) =>
      (b.daily?.met ?? 0) - (a.daily?.met ?? 0) ||
      (b.pb?.met ?? 0) - (a.pb?.met ?? 0)
    );
};

// Every rival with a record on either board, for the head-to-head sheet the
// profile's short list opens. Same shape and same rules as the profile's rows
// (see mergeRivals); it is a separate call so the full list is fetched when a
// player asks for it rather than riding on every boot.
export const getUserRivals = async (user: string) => {
  const [daily, pb] = await sql<[RivalRow[], RivalRow[]]>`
    ${raw(rivals(user, "AND r.ranked = TRUE"))};

    ${raw(rivals(user, ""))};
  `;
  return mergeRivals(daily, pb);
};

// The ranked daily attempts (at most three, by construction of the `ranked`
// flag — see db/run.ts startRun), oldest first, with the maze each run built
// (result modal, attempts-remaining). Void included — an abandoned attempt
// still spends a slot.
export const attemptRunsByIteration = (user: string, iteration: number) =>
  sql<{ time: number; data: string; created: string }[]>`
    SELECT time, data, created
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND ranked = TRUE
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) =>
    r.map((run) => ({
      time: run.time,
      maze: deserializeRun(run.data),
      created: new Date(run.created).getTime(),
    }))
  );

// The user's own runs on an iteration (their ranked attempts plus any free
// play), oldest first, with each run's maze, creation time, and whether it was a
// ranked daily attempt — read straight off the `ranked` flag recorded at start
// time (see db/run.ts startRun), the only moment the timezone-aware daily check
// can be made.
//
// Non-void runs are always returned, plus voided runs that are ranked attempts
// (a daily attempt started but never built still counts as spent). Voided free
// play — abandoned, incl. a never-run build — stays hidden so the panel isn't
// padded with empty rows.
export const allRunsByIteration = (user: string, iteration: number) =>
  sql<
    {
      time: number;
      data: string;
      created: string;
      ranked: number;
      pinned: number;
    }[]
  >`
    SELECT time, data, created, ranked, pinned
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND (void = FALSE OR ranked = TRUE)
    ORDER BY created ASC
    LIMIT ${RUN_CAP};
  `.then(async (r) => {
    // At the cap the panel is truncating this player's runs (the query returns
    // their OLDEST RUN_CAP, so newer ones silently drop). Warn an operator once.
    if (r.length >= RUN_CAP) {
      const key = `${user}:${iteration}`;
      if (!capAlerted.has(key)) {
        capAlerted.add(key);
        // The log flows to VictoriaLogs, so it gets the hashed id (hashUserId).
        // The Discord alert deliberately keeps the RAW id: it's a low-volume,
        // access-controlled operator channel, and the raw id is what lets an
        // operator look the player up in the DB (there is no hash column to join
        // on). If that channel's trust boundary ever changes, hash this too.
        log.warn("attempts cap hit", {
          userHash: await hashUserId(user),
          iteration,
        });
        alertAdmin(
          `Player \`${user}\` hit the ${RUN_CAP}-run cap on iteration ` +
            `${iteration}; the attempts panel is now dropping their oldest runs.`,
        );
      }
    }
    return r.map((run) => ({
      time: run.time,
      maze: deserializeRun(run.data),
      created: new Date(run.created).getTime(),
      ranked: !!run.ranked,
      pinned: !!run.pinned,
    }));
  });

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
  -- void = FALSE lives in the ON clause, not WHERE, so a day whose only runs are
  -- voided still returns its row (with null aggregates) rather than dropping out
  -- of the page. Without this, a lone voided run feeds ownBest/best and lights up
  -- a calendar cell — even flagging supreme — for a run that shouldn't count.
  LEFT JOIN run ON iteration.id = run.iteration AND run.void = FALSE
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

// The user's own best build on an iteration, void (abandoned) runs excluded —
// consistent with every board/standings query, so an abandoned free-play maze
// doesn't count as your best or inflate the board target.
export const getOwnBest = (user: string, iteration: number) =>
  sql<{ ownBest: number }[] | null>`
    SELECT max(time) ownBest
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND void = FALSE;`.then((r) => r?.[0].ownBest ?? null);

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

// The `user.plays` column is the rating system's experience counter — NOT the
// profile's "Played" statistic (getUserStats), which is a deliberately different
// and broader number. `plays` counts only the dailies a player has been *rated*
// on: incremented once per rated iteration for each ranked participant (see
// rateDailies / applyRatings), i.e. days where they completed a ranked run
// (void = FALSE) AND were ranked against at least one other player, on a daily
// that has since closed and been rated. Today's daily and solo-player days don't
// count. It exists solely to decay the ELO K-factor, `K / log2(plays + 2)`
// (rating.ts) — nothing reads it for display. The profile "Played" figure, by
// contrast, is COUNT(DISTINCT daily iteration) with no void/rated/opponent
// gating, so it reflects every daily the player attempted, current day included.
//
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
