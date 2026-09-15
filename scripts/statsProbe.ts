// Read-only calibration probe for the profile stats redesign. Prints the
// distributions you need to decide whether a proposed stat actually separates
// players — or whether it collapses to one value for everybody.
//
// This writes NOTHING (there is no --apply); it is safe against prod.
//
//   APP_ENV=prod SQL_PASSWORD=... \
//     deno run --allow-net --allow-sys --allow-env=APP_ENV,SQL_PASSWORD,SQL_PROXY_URL,SQL_TRANSPORT,SQL_HOST,SQL_PORT,SQL_USER,SQL_DATABASE \
//     scripts/statsProbe.ts
//
// The percentile arithmetic below is copied from getUserStats (server/db/user.ts)
// on purpose — self-excluded, ties at half, days with no other player skipped —
// so "median percentile" here is the same number the profile shows today and the
// before/after of a redesign is a fair comparison.
//
// Read this as a snapshot of the game under ONE shared field. Once heats have
// their own mazes, a puzzle's field IS its heat and nothing outside it ever plays
// that board, so the field-size histogram below stops being a measurement and
// becomes a product decision (whatever heat sizes you get) — treat it as the
// upper bound a heat could reach, not as a prediction.
//
// What DOES transfer is everything shaped by the game rather than the field: the
// spread of `standing`, how often a top time is shared, attempts-to-best, and
// streaks. Those are properties of the puzzle design and carry into any heat
// size, so they are the numbers worth calibrating a stat against.

import { sql } from "../server/db/query.ts";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const f2 = (n: number) => n.toFixed(2);

// Quantiles over a sorted copy; q in [0,1]. Linear interpolation between
// neighbours, so a small sample doesn't snap to a member value and overstate
// how tidy the distribution is.
const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

const summarize = (label: string, xs: number[], fmt: (n: number) => string = f2) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return console.log(`${label.padEnd(26)} (no data)`);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(
    `${label.padEnd(26)} n=${String(s.length).padStart(5)}  ` +
      `min=${fmt(s[0])}  p25=${fmt(quantile(s, 0.25))}  med=${fmt(quantile(s, 0.5))}  ` +
      `p75=${fmt(quantile(s, 0.75))}  p90=${fmt(quantile(s, 0.9))}  max=${fmt(s[s.length - 1])}  mean=${fmt(mean)}`,
  );
};

// A count histogram over small integers, bucketed so a long tail stays readable.
const histogram = (label: string, xs: number[], buckets: number[]) => {
  console.log(`\n${label}`);
  const total = xs.length || 1;
  for (let i = 0; i < buckets.length; i++) {
    const lo = buckets[i];
    const hi = buckets[i + 1] ?? Infinity;
    const n = xs.filter((x) => x >= lo && x < hi).length;
    const name = hi === Infinity ? `${lo}+` : hi - lo === 1 ? `${lo}` : `${lo}-${hi - 1}`;
    const bar = "#".repeat(Math.round((n / total) * 40));
    console.log(`  ${name.padStart(7)} | ${String(n).padStart(5)} ${pct(n / total).padStart(7)} ${bar}`);
  }
};

const section = (title: string) => console.log(`\n\n=== ${title} ===`);

// ---------------------------------------------------------------- scale

section("SCALE");

const [scale] = await sql<{
  users: number;
  iterations: number;
  rated: number;
  runs: number;
  liveRuns: number;
  dailyRuns: number;
}[]>`
  SELECT
    (SELECT COUNT(*) FROM user) users,
    (SELECT COUNT(*) FROM iteration) iterations,
    (SELECT COUNT(*) FROM iteration WHERE rated = TRUE) rated,
    (SELECT COUNT(*) FROM run) runs,
    (SELECT COUNT(*) FROM run WHERE void = FALSE) liveRuns,
    (SELECT COUNT(*) FROM run WHERE void = FALSE AND daily = TRUE) dailyRuns;
`;
console.log(scale);

// ---------------------------------------------------- field size per daily

// The decisive histogram. With a median field of 3, a "median percentile" takes
// about four distinct values and a "top 10%" tile reads 0 for nearly everyone —
// both stats are then measuring field size, not skill. Heats push this number
// DOWN (a private league is a smaller field than the global one), so read this
// as the optimistic case for anything percentile-shaped.
section("FIELD SIZE PER DAILY (distinct ranked players per iteration)");

const fields = await sql<{ iteration: number; players: number; topTime: number; holders: number }[]>`
  SELECT iteration,
         COUNT(DISTINCT user) players,
         ROUND(MAX(time), 2) topTime,
         COUNT(DISTINCT CASE WHEN time = m.top THEN user END) holders
  FROM run
  JOIN (SELECT iteration i, MAX(time) top FROM run WHERE void = FALSE AND daily = TRUE GROUP BY i) m
    ON m.i = run.iteration
  WHERE void = FALSE AND daily = TRUE
  GROUP BY iteration
  ORDER BY iteration;
`;

const players = fields.map((r) => Number(r.players));
summarize("players/daily", players, (n) => String(Math.round(n)));
histogram("distribution:", players, [1, 2, 3, 5, 9, 17, 33, 65]);

// How often the daily top is SHARED. This is the supreme-vs-record split, and
// it is the other thing heats change: in a small field an equivalent-length
// solution is found by several people, so "record" (shared top) becomes the
// modal status and "supreme" becomes rare. If the shared rate is already high
// globally, it will be much higher inside a 6-person heat.
const shared = fields.filter((r) => Number(r.holders) > 1).length;
console.log(
  `\ndailies whose top time is shared: ${shared}/${fields.length} (${pct(shared / (fields.length || 1))})`,
);
summarize("holders of the top", fields.map((r) => Number(r.holders)), (n) => String(Math.round(n)));

// ------------------------------------------------- per-player current stats

section("CURRENT PROFILE STATS, AS DISTRIBUTED TODAY");

// Mirrors getUserStats for every user at once: their best daily time per
// iteration, against every OTHER player's best daily time on that iteration.
const ranks = await sql<{
  user: string;
  iteration: number;
  less: number;
  equal: number;
  more: number;
  others: number;
}[]>`
  SELECT me.user user, me.iteration iteration,
         SUM(CASE WHEN other.t < me.t THEN 1 ELSE 0 END) less,
         SUM(CASE WHEN other.t = me.t THEN 1 ELSE 0 END) equal,
         SUM(CASE WHEN other.t > me.t THEN 1 ELSE 0 END) more,
         COUNT(other.u) others
  FROM (
    SELECT user, iteration, MAX(time) t
    FROM run WHERE void = FALSE AND daily = TRUE GROUP BY user, iteration
  ) me
  LEFT JOIN (
    SELECT user u, iteration, MAX(time) t
    FROM run WHERE void = FALSE AND daily = TRUE GROUP BY u, iteration
  ) other ON other.iteration = me.iteration AND other.u != me.user
  GROUP BY me.user, me.iteration;
`;

const byUser = new Map<string, number[]>();
const hundredsBy = new Map<string, number>();
for (const r of ranks) {
  const others = Number(r.others);
  if (others === 0) continue;
  const p = Number(r.more) === 0 ? 1 : (Number(r.less) + Number(r.equal) / 2) / others;
  (byUser.get(r.user) ?? byUser.set(r.user, []).get(r.user)!).push(p);
  if (p === 1) hundredsBy.set(r.user, (hundredsBy.get(r.user) ?? 0) + 1);
}

const medians: number[] = [];
for (const ps of byUser.values()) {
  ps.sort((a, b) => a - b);
  medians.push(quantile(ps, 0.5));
}
summarize("median percentile", medians, pct);
summarize("rankable days/player", [...byUser.values()].map((p) => p.length), (n) => String(Math.round(n)));

// "Records" as the profile counts it today (hundreds): ranked-field p100, ties
// included. Note this is a DIFFERENT notion from the calendar's gold `supreme`
// cell, which compares all non-void runs including free play — the mismatch is
// worth seeing quantified before picking one definition.
const hundreds = [...byUser.keys()].map((u) => hundredsBy.get(u) ?? 0);
summarize("records (hundreds)", hundreds, (n) => String(Math.round(n)));
histogram("records per player:", hundreds, [0, 1, 2, 4, 8, 16, 32]);
console.log(
  `players with zero records: ${hundreds.filter((h) => h === 0).length}/${hundreds.length} ` +
    `(${pct(hundreds.filter((h) => h === 0).length / (hundreds.length || 1))})`,
);

const playedRows = await sql<{ user: string; played: number }[]>`
  SELECT user, COUNT(DISTINCT iteration) played
  FROM run WHERE daily = TRUE GROUP BY user;
`;
summarize("played (dailies)", playedRows.map((r) => Number(r.played)), (n) => String(Math.round(n)));

// -------------------------------------------------------- par-shaped stats

// `standing(time, min, best)` from common/standing.ts: where your best build
// falls in the range between the unobstructed floor and the best time anyone has
// posted on that puzzle. Here `best` is the observed maximum, which is the only
// ceiling available today — but with per-heat mazes an observed ceiling is just
// the heat's own best, so this is really a stand-in for a COMPUTED par stored on
// the iteration. The spread is what matters either way: wide means a "% of par"
// stat separates players, everyone at 0.97 means it does not.
section("PAR-SHAPED: standing vs the best known time (all runs, free play included)");

const standings = await sql<{ user: string; iteration: number; own: number; best: number; min: number }[]>`
  SELECT r.user user, r.iteration iteration,
         ROUND(MAX(r.time), 2) own, b.best best, i.min min
  FROM run r
  JOIN iteration i ON i.id = r.iteration
  JOIN (SELECT iteration, MAX(time) best FROM run WHERE void = FALSE GROUP BY iteration) b
    ON b.iteration = r.iteration
  WHERE r.void = FALSE
  GROUP BY r.user, r.iteration, b.best, i.min;
`;

const standing = (time: number, min: number, best: number) =>
  best <= min ? 1 : Math.max(0, Math.min(1, (time - min) / (best - min)));

const perPuzzle = standings.map((r) => standing(Number(r.own), Number(r.min), Number(r.best)));
summarize("standing (per puzzle)", perPuzzle, pct);
histogram("standing distribution:", perPuzzle.map((s) => Math.floor(s * 10)), [0, 2, 4, 6, 7, 8, 9, 10]);

const meanStandingBy = new Map<string, number[]>();
for (let i = 0; i < standings.length; i++) {
  const u = standings[i].user;
  (meanStandingBy.get(u) ?? meanStandingBy.set(u, []).get(u)!).push(perPuzzle[i]);
}
summarize(
  "mean standing/player",
  [...meanStandingBy.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length),
  pct,
);

// How many players hold the top build outright on at least one puzzle, across
// all history. This is the free-play "supremes held" tile, and the number that
// decides whether a library-completion bar reads as an achievable challenge or
// as a permanently grey bar for 99% of players. Heat-scoping is what rescues it.
const topBy = new Map<string, number>();
const sharedTop = new Map<string, number>();
const holdersByIter = new Map<number, string[]>();
for (const r of standings) {
  if (Number(r.own) === Number(r.best)) {
    const it = Number(r.iteration);
    (holdersByIter.get(it) ?? holdersByIter.set(it, []).get(it)!).push(r.user);
  }
}
for (const [, hs] of holdersByIter) {
  for (const u of hs) {
    if (hs.length === 1) topBy.set(u, (topBy.get(u) ?? 0) + 1);
    else sharedTop.set(u, (sharedTop.get(u) ?? 0) + 1);
  }
}
const allUsers = [...new Set(standings.map((r) => r.user))];
summarize("supremes held", allUsers.map((u) => topBy.get(u) ?? 0), (n) => String(Math.round(n)));
summarize("records held (shared)", allUsers.map((u) => sharedTop.get(u) ?? 0), (n) => String(Math.round(n)));
console.log(
  `players holding >=1 supreme: ${topBy.size}/${allUsers.length} (${pct(topBy.size / (allUsers.length || 1))})`,
);
console.log(
  `puzzles whose top build is shared: ` +
    `${[...holdersByIter.values()].filter((h) => h.length > 1).length}/${holdersByIter.size}`,
);

// ------------------------------------------------------ three-attempt shape

// Which of the three ranked attempts turned out to be the player's best. A
// median of 1 says the first read is usually the whole story and an
// "attempts to best" tile would be flat; a spread says it is a real stat.
section("THREE-ATTEMPT SHAPE (position of the best ranked attempt)");

const attempts = await sql<{ user: string; iteration: number; pos: number; n: number }[]>`
  SELECT r.user user, r.iteration iteration,
         COUNT(*) n,
         SUM(CASE WHEN r.created <= b.bestCreated THEN 1 ELSE 0 END) pos
  FROM run r
  JOIN (
    -- The EARLIEST attempt that reached the player's best time on that day, so a
    -- later attempt that merely matched it doesn't inflate the position.
    SELECT x.user u, x.iteration i, MIN(x.created) bestCreated
    FROM run x
    JOIN (
      SELECT user, iteration, MAX(time) mt
      FROM run WHERE void = FALSE AND daily = TRUE GROUP BY user, iteration
    ) m ON m.user = x.user AND m.iteration = x.iteration AND m.mt = x.time
    WHERE x.void = FALSE AND x.daily = TRUE
    GROUP BY x.user, x.iteration
  ) b ON b.u = r.user AND b.i = r.iteration
  WHERE r.void = FALSE AND r.daily = TRUE
  GROUP BY r.user, r.iteration;
`;
// pos = how many attempts had been made by the time the best one landed, i.e.
// 1 means the first attempt was never beaten.
summarize("attempts used", attempts.map((r) => Number(r.n)), (n) => String(Math.round(n)));
histogram("attempts to best:", attempts.map((r) => Number(r.pos)), [1, 2, 3, 4]);

// ------------------------------------------------------------- streaks

// Consecutive days with a completed ranked attempt, by the iteration's UTC date.
// This is the one proposed daily stat that needs no field at all, so it is
// equally valid in a heat of one and a heat of four hundred.
section("STREAKS (consecutive dailies completed, UTC dates)");

const days = await sql<{ user: string; d: string }[]>`
  SELECT DISTINCT r.user user, i.created d
  FROM run r JOIN iteration i ON i.id = r.iteration
  WHERE r.void = FALSE AND r.daily = TRUE
  ORDER BY r.user, i.created;
`;
const daysBy = new Map<string, string[]>();
for (const r of days) (daysBy.get(r.user) ?? daysBy.set(r.user, []).get(r.user)!).push(String(r.d).slice(0, 10));

const best: number[] = [];
for (const ds of daysBy.values()) {
  let run = 1, top = 1;
  for (let i = 1; i < ds.length; i++) {
    const gap = (Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 86400000;
    run = gap === 1 ? run + 1 : 1;
    top = Math.max(top, run);
  }
  best.push(top);
}
summarize("best streak", best, (n) => String(Math.round(n)));
histogram("best streak:", best, [1, 2, 3, 5, 8, 15, 31]);

console.log("\ndone (read-only; nothing was written)\n");
