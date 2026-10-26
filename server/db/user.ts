import { avatarHue } from "../../common/avatar.ts";
import { randomName } from "../../common/random/name.ts";
import { parseSettings } from "../../common/settings.ts";
import { alertAdmin } from "../util/adminAlert.ts";
import { discordCode } from "../util/discordText.ts";
import { hashUserId } from "../util/hashUserId.ts";
import { log } from "../util/logging.ts";
import { deserializeRun } from "../util/run.ts";
import { streaks } from "../util/streak.ts";
import { format, raw, sql } from "./query.ts";

// The most runs the attempts panel loads for one player on one iteration: above
// any real player (a heavy free-play replayer sits in the low hundreds), but a
// hard ceiling on the maze list a client can make us serialize. At the cap the
// panel drops the player's NEWEST runs (allRunsByIteration keeps the oldest
// RUN_CAP), which warrants an operator alert.
const RUN_CAP = 10_000;
// Dedupes the cap alert to once per (user, iteration) per process; the read
// runs on every board load.
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
    // Seeds a random name on first insert and backfills one onto an existing
    // user lacking it; COALESCE keeps a chosen name.
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

// Upsert, so it works for a user whose row isn't seeded yet (a later
// createOrUpdateUser backfills the name).
export const updateUserSettings = (id: string, settings: string) =>
  sql`
    INSERT INTO user (id, settings) VALUES (${id}, ${settings})
    ON DUPLICATE KEY UPDATE settings = ${settings};`;

// The user's BCP-47 locale, reported by a subscribing device so push copy can
// match it. Upsert like updateUserSettings; the caller passes only a
// canonicalised non-null tag, so a known locale is never clobbered by a bad
// one.
export const updateUserLocale = (id: string, locale: string) =>
  sql`
    INSERT INTO user (id, locale) VALUES (${id}, ${locale})
    ON DUPLICATE KEY UPDATE locale = ${locale};`;

// The profile's stats in one round trip, all derived from stored runs:
//   1. the user's own row (name, rating, join date, settings);
//   2. RANKED, over closed (rated) days with a field: days they took the top
//      time alone or shared, and how many such days there were. A day nobody
//      else played is skipped (no field to win), as in the calendar's ranking;
//   3. SOLVES: days where a ranked attempt equalled the best build anyone has
//      made on the board, and the subset where the FIRST attempt did. The bar
//      is the board's CURRENT best, free play included, so a solve is lost
//      again if someone later builds longer;
//   4. FREE PLAY: boards where their best build is the top, alone (supreme) or
//      shared (record), boards played, and how many boards exist;
//   5. the dates of their ranked attempts, for the streak (util/streak.ts);
//   6. HEAD-TO-HEAD per rival on both boards. Rows ship `name` + `hue`, never
//      the rival's id: the raw id is the bearer credential (common/avatar.ts).
// Both sides of a comparison are a per-iteration MAX over the same `time`
// column, so equality is exact.
//
// Cost follows the PLAYER, not the table: every field-side read starts from
// the iterations the player has runs on (`playedIterations`) and joins those
// iterations' runs through the (iteration, …) index; nothing groups over the
// whole run table. The joins are STRAIGHT_JOINs because left to choose,
// MariaDB scanned all of `run` and probed the player's iterations (EXPLAIN on
// prod).
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
      FROM (${raw(playedIterations(user, "AND ranked = TRUE"))}) p
      STRAIGHT_JOIN iteration i ON i.id = p.iteration AND i.rated = TRUE
      STRAIGHT_JOIN run r ON r.iteration = p.iteration AND r.ranked = TRUE AND r.void = FALSE
      GROUP BY p.iteration
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
      SELECT p.iteration, MAX(r.time) best
      FROM (${raw(playedIterations(user, "AND ranked = TRUE"))}) p
      STRAIGHT_JOIN run r ON r.iteration = p.iteration AND r.void = FALSE
      GROUP BY p.iteration
    ) top ON top.iteration = mine.iteration;

    SELECT
      SUM(CASE WHEN others IS NULL OR mine > others THEN 1 ELSE 0 END) supremes,
      SUM(CASE WHEN mine = others THEN 1 ELSE 0 END) records,
      COUNT(*) played
    FROM (
      SELECT MAX(CASE WHEN r.user = ${user} THEN r.time END) mine,
             MAX(CASE WHEN r.user != ${user} THEN r.time END) others
      FROM (${raw(playedIterations(user, ""))}) p
      STRAIGHT_JOIN run r ON r.iteration = p.iteration AND r.void = FALSE
      GROUP BY p.iteration
    ) b;

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

// The iterations `user` has a non-void run on (`filter` narrows it, e.g. to
// ranked), as a derived table driving getUserStats's field-side joins.
const playedIterations = (user: string, filter: string) =>
  format`
    SELECT DISTINCT iteration FROM run
    WHERE user = ${user} AND void = FALSE ${raw(filter)}`;

// A rival's record on one board: the viewer's best time per iteration against
// each other player's, over the iterations both ran. `rankedOnly` narrows both
// sides to ranked attempts (the daily board); empty counts every non-void run
// (the PB board). SQL text so both boards share one shape. The field side
// starts from the viewer's own iterations (`m`).
const rivals = (user: string, rankedOnly: string) =>
  format`
    SELECT o.user user, u.name name, COUNT(*) met,
           SUM(CASE WHEN o.mt > o.t THEN 1 ELSE 0 END) won,
           SUM(CASE WHEN o.mt < o.t THEN 1 ELSE 0 END) lost,
           SUM(CASE WHEN o.mt = o.t THEN 1 ELSE 0 END) tied
    FROM (
      SELECT m.iteration, m.t mt, r.user, MAX(r.time) t
      FROM (
        SELECT iteration, MAX(time) t FROM run r
        WHERE r.user = ${user} AND r.void = FALSE ${raw(rankedOnly)}
        GROUP BY iteration
      ) m
      STRAIGHT_JOIN run r ON r.iteration = m.iteration
      WHERE r.user != ${user} AND r.void = FALSE ${raw(rankedOnly)}
      GROUP BY m.iteration, m.t, r.user
    ) o
    JOIN user u ON u.id = o.user
    GROUP BY o.user, u.name
    ORDER BY met DESC
    LIMIT ${RIVAL_CAP}`;

// Meetings a pair needs on a board before that board's record appears.
const RIVAL_MINIMUM = 5;
// Rows sent for the profile's own list, most-met first. Five fits the desktop
// dialog's two-column layout; stacked, the client shows one fewer (Profile.tsx)
// by slicing, so a player with exactly five rivals still gets a "see all".
const RIVAL_PREVIEW = 5;
// Ceiling on one query's rows, so a runaway field can't make the response
// unbounded.
const RIVAL_CAP = 500;

// One row per rival carrying both boards, with the id reduced to its avatar
// hue. A rival appears if EITHER board has enough meetings; a board below the
// minimum is null.
export const mergeRivals = (daily: RivalRow[], pb: RivalRow[]) => {
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

// Every rival with a record on either board, for the head-to-head sheet. Same
// rows and rules as getUserStats's (mergeRivals), fetched on demand rather than
// on every boot.
export const getUserRivals = async (user: string) => {
  const [daily, pb] = await sql<[RivalRow[], RivalRow[]]>`
    ${raw(rivals(user, "AND r.ranked = TRUE"))};

    ${raw(rivals(user, ""))};
  `;
  return mergeRivals(daily, pb);
};

// The ranked daily attempts (at most three, by construction of `ranked` in
// db/run.ts startRun), oldest first, with each run's maze. Void included: an
// abandoned attempt still spends a slot.
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

// The user's own runs on an iteration (ranked attempts plus free play), oldest
// first, with each run's maze, creation time, and the `ranked` flag recorded
// by db/run.ts startRun.
//
// Non-void runs are returned, plus void ranked attempts (started but never
// built, still spent). Void free-play rows, which only the legacy commitRun
// path leaves, stay hidden so the panel has no empty rows.
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
    // At the cap the newer runs silently drop. Warn an operator once.
    if (r.length >= RUN_CAP) {
      const key = `${user}:${iteration}`;
      if (!capAlerted.has(key)) {
        capAlerted.add(key);
        // The log goes to VictoriaLogs, so it gets the hashed id. The Discord
        // alert keeps the RAW id: the channel is low-volume and
        // access-controlled, and the raw id is what lets an operator find the
        // player in the DB. Hash it too if that channel's trust boundary
        // changes.
        log.warn("attempts cap hit", {
          userHash: await hashUserId(user),
          iteration,
        });
        alertAdmin(
          // discordCode: the id is the caller's authorization header, so
          // attacker-chosen text that must not close the code span.
          `Player ${
            discordCode(user)
          } hit the ${RUN_CAP}-run cap on iteration ` +
            `${iteration}; the attempts panel is now dropping their newest runs.`,
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

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = ([y, m, d]: [number, number, number]) =>
  `${y}-${pad(m)}-${pad(d)}`;

export const listDailies = async (
  user: string,
  opts: {
    start?: [number, number, number] | undefined;
    end?: [number, number, number] | undefined;
    limit?: number;
  } = {},
) => {
  // Default window: the current UTC month, since a daily's date is its UTC
  // creation date. Callers page back with explicit start/end.
  let { start, end } = opts;
  if (!start && !end) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    start = [y, m + 1, 1];
    end = m === 11 ? [y + 1, 1, 1] : [y, m + 2, 1];
  }
  // Safety cap; the range does the real bounding (a month is ~31 rows).
  const limit = opts.limit ?? 400;

  const bounds = [
    start ? format`AND iteration.created >= ${dateStr(start)}` : "",
    end ? format`AND iteration.created < ${dateStr(end)}` : "",
  ].join(" ");

  // The user's played days within the window, inlined into both statements
  // below. The derived table is needed because MySQL rejects a LIMIT directly
  // inside an IN (...) subquery.
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

  // Three statements, one round trip: per-day aggregates; the pieces of each
  // day's ranked-daily percentile (the user's best daily attempt against each
  // other player's best), which needs the whole field so can't fold into the
  // GROUP BY; and the first iteration's date.
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

  // The first daily's date: the calendar's paging floor, independent of which
  // months the user played.
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
    // 0..1 percentile of the user's best daily attempt vs other players' best;
    // 1 means they equalled or bettered everyone. null with no daily attempt or
    // no other players.
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

// The user's own best build on an iteration. Void runs are excluded, as in
// every board/standings query: a void row is not a build.
export const getOwnBest = (user: string, iteration: number) =>
  sql<{ ownBest: number }[] | null>`
    SELECT max(time) ownBest
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND void = FALSE;`.then((r) => r?.[0]?.ownBest ?? null);

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

// `user.plays` is the rating system's experience counter, NOT the profile's
// "Played" statistic (getUserStats). It counts only dailies the player was
// *rated* on: +1 per rated iteration (rateDailies / applyRatings) for days they
// completed a ranked run (void = FALSE) and were ranked against at least one
// other player. Today's daily and solo days don't count. It only decays the ELO
// K-factor, `K / log2(plays + 2)` (rating.ts); nothing displays it. The
// profile's "Played" is COUNT(DISTINCT daily iteration) with no void, rated or
// opponent gating.
//
// Each completer of an iteration's daily, with their best time and current
// rating/plays. Abandoners (no completed run) are not rated.
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

// The UPDATE applyRatings runs: each listed player's delta, picked by a CASE on
// their id, gated on the claim. Literals are matched against `user.id` directly
// (not a JOINed derived table) to avoid a collation mix; the IN list makes it a
// primary-key lookup. `+ 0e0` makes each delta a DOUBLE so DECIMAL literals of
// different scales can't truncate to a common type. GREATEST(0, …) because the
// column is unsigned and the drift described at applyRatings could dip a
// near-zero rating under it. Non-empty input only.
export const ratingDeltaUpdate = (deltas: { user: string; delta: number }[]) =>
  `UPDATE user
    SET rating = GREATEST(0, rating + CASE id ${
    deltas.map((d) => format`WHEN ${d.user} THEN ${d.delta} + 0e0`).join(" ")
  } END),
      plays = plays + 1
    WHERE @claimed > 0 AND id IN (${format`${deltas.map((d) => d.user)}`});`;

// Claims the iteration for rating and applies its rating deltas in one
// transaction. Resolves whether THIS call made the claim; the caller sends the
// day's notifications and Discord posts only then.
//
// The claim is `rated = FALSE -> TRUE`, and every delta is gated on it. Without
// it, two writers on one DB (a second instance missing DISABLE_CRONS, a dev
// deploy pointed at prod) would both rate the day and double every ELO change
// and post. With it, the loser blocks on the winner's row lock, re-reads
// `rated = TRUE`, matches nothing, and applies nothing. `@claimed` is read
// after COMMIT in the same batch (one connection, so the session variable
// carries).
//
// Deltas are relative to the stored row, not absolute ratings: participants
// are read before this transaction, so an absolute write would undo another
// day's rating committed in between. (The delta itself is computed off that
// slightly earlier rating, a negligible drift unlike a lost update.) It is an
// UPDATE of EXISTING rows, not `INSERT … ON DUPLICATE KEY UPDATE`: a player
// merged away or erased (deleteAccount rotates the id) between read and write
// must not reappear under their old id, which is their credential.
//
// Retry-safe (`sql`): a retry after a lost response finds the day claimed and
// changes nothing, so it reports "not claimed" and that day's notifications are
// skipped rather than sent twice.
export const applyRatings = async (
  iteration: number,
  deltas: { user: string; delta: number }[],
) => {
  const r = await sql<unknown[]>`
    START TRANSACTION;
    UPDATE iteration SET rated = TRUE WHERE id = ${iteration} AND rated = FALSE;
    SET @claimed := ROW_COUNT();
    ${raw(deltas.length === 0 ? "" : ratingDeltaUpdate(deltas))}
    COMMIT;
    SELECT @claimed claimed;
  `;
  const last = r[r.length - 1] as { claimed: number | string }[];
  return Number(last[0]?.claimed) > 0;
};
