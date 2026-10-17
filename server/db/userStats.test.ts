import { assertEquals } from "@std/assert";
import { format, raw, sql } from "./query.ts";
import { getUserRivals, getUserStats, mergeRivals } from "./user.ts";

// getUserStats' queries were rewritten to reach the field through the player's
// own iterations instead of grouping over the whole run table. This checks the
// rewrite against the ORIGINAL whole-table SQL (kept verbatim below) for a
// sample of real players on the dev database. Skipped without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const legacyRivals = (user: string, rankedOnly: string) =>
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
    LIMIT 500`;

type Row = Record<string, number | string | null>;
type RivalRows = Parameters<typeof mergeRivals>[0];

const legacyStats = async (user: string) => {
  const [ranked, solves, boards, daily, pb] = await sql<
    [Row[], Row[], Row[], RivalRows, RivalRows]
  >`
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

    ${raw(legacyRivals(user, "AND r.ranked = TRUE"))};

    ${raw(legacyRivals(user, ""))};
  `;
  return {
    rankedDays: Number(ranked[0]?.days ?? 0),
    wonSole: Number(ranked[0]?.sole ?? 0),
    wonShared: Number(ranked[0]?.shared ?? 0),
    solved: Number(solves[0]?.solved ?? 0),
    solvedFirstTry: Number(solves[0]?.firstTry ?? 0),
    supremes: Number(boards[0]?.supremes ?? 0),
    records: Number(boards[0]?.records ?? 0),
    boardsPlayed: Number(boards[0]?.played ?? 0),
    rivals: mergeRivals(daily, pb),
  };
};

// Rival order among equal meeting counts is unspecified (ORDER BY met only),
// so compare the lists as sets.
const sorted = <T>(xs: T[]) => xs.map((x) => JSON.stringify(x)).sort();

Deno.test({
  name: "getUserStats matches the original whole-table queries",
  ignore: !live,
  fn: async () => {
    // The heaviest players plus a random spread of others.
    const users = await sql<{ user: string }[]>`
      (SELECT user FROM run GROUP BY user ORDER BY COUNT(*) DESC LIMIT 10)
      UNION
      (SELECT user FROM run GROUP BY user ORDER BY RAND() LIMIT 20);
    `;
    for (const { user } of users) {
      const [now, before, rivals] = await Promise.all([
        getUserStats(user),
        legacyStats(user),
        getUserRivals(user),
      ]);
      const { rivals: beforeRivals, ...beforeCounts } = before;
      assertEquals(
        {
          rankedDays: now.rankedDays,
          wonSole: now.wonSole,
          wonShared: now.wonShared,
          solved: now.solved,
          solvedFirstTry: now.solvedFirstTry,
          supremes: now.supremes,
          records: now.records,
          boardsPlayed: now.boardsPlayed,
        },
        beforeCounts,
      );
      assertEquals(sorted(rivals), sorted(beforeRivals));
      assertEquals(now.rivalCount, beforeRivals.length);
    }
  },
});
