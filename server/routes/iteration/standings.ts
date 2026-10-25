// The standings: the podium plus the viewer's neighbourhood, their own rank and
// the field size (the standings dock and its sheet). "Today" resolves from the
// caller's timezone like getDailySummary; { iteration } serves a specific day.
//
// One request returns two boards over the SAME day's runs, so the client can
// toggle without a round trip:
//   - "daily" ranks players with a ranked daily run by that time (secondary:
//     their best build that day);
//   - "pb" ranks EVERYONE with a non-void run by best build that day
//     (secondary: ranked daily time, or null if they only free-played).
// Each board is ranked and windowed server-side; ids never reach the wire.

import { z } from "zod";
import { avatarHue } from "../../../common/avatar.ts";
import { standing } from "../../../common/standing.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
import {
  getDailyStandings,
  getIterationBests,
  getStandingsMeta,
} from "../../db/standings.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { LRUMap } from "../../util/LRUMap.ts";
import { buildStandings, type FieldEntry } from "../../util/standings.ts";
import { method } from "../apiHelpers.ts";

// "today" (from the caller's timezone), an iteration, or a calendar day (a
// `/YYYYMMDD` permalink or notification deep-link knows the date, not the id).
const standingsBody = z.union([
  z.object({ timeZone: z.string() }),
  z.object({ iteration: z.number().min(1) }),
  z.object({
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
]);

// How long a cached field is served. Applies to every day: free play counts
// toward the PB board, so even a closed day's field can still move.
const FRESH_MS = 15_000;

// 37h after a day starts every timezone's window has closed (UTC-12 leaves it
// at +36h) and the rating cron picks it up: the "until ranked" countdown
// target. Keep in step with getUnratedClosedIterations' close-plus-pad.
const CLOSE_MS = 37 * 3_600_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// One player on the day, with both boards' values and when each was set: their
// best non-void build (`pb`/`pbAt`) and best RANKED daily run
// (`daily`/`dailyAt`; null/0 if they only free-played). `project` turns this
// into a FieldEntry per board.
export type Player = {
  user: string;
  name: string;
  hue: number;
  daily: number | null;
  dailyAt: number;
  pb: number;
  pbAt: number;
};

type Field = {
  rated: boolean;
  day: [number, number, number];
  closesAt: number;
  min: number; // the par floor, for a run's standing in [min, best]
  players: Player[]; // everyone with a non-void run on the day
};

// The day's field: everyone with a non-void run (getIterationBests), plus their
// best ranked time where they made ranked attempts (getDailyStandings). A day
// only free-played still populates the PB board with an empty daily field.
const loadField = async (iteration: number): Promise<Field> => {
  const [meta, dailyRows, bests] = await Promise.all([
    getStandingsMeta(iteration),
    getDailyStandings(iteration),
    getIterationBests(iteration),
  ]);
  const daily = new Map(
    dailyRows.map((r) => [r.user, { time: round2(r.time), at: Number(r.at) }]),
  );
  return {
    rated: !!meta.rated,
    day: [meta.y, meta.m, meta.d],
    closesAt: Number(meta.dayStart) + CLOSE_MS,
    min: Number(meta.min) || 0,
    // The id stays server-side: buildStandings uses it to find the viewer and
    // attach secondaries; rows ship name + hue.
    players: bests.map((b) => {
      const d = daily.get(b.user);
      return {
        user: b.user,
        name: b.name ?? "anonymous",
        hue: avatarHue(b.user),
        daily: d ? d.time : null,
        dailyAt: d ? d.at : 0,
        pb: round2(b.best),
        pbAt: Number(b.at),
      };
    }),
  };
};

// A day's field is identical for every viewer: fetch once per FRESH_MS and let
// each request slice its own view. The LRU bounds memory. A failed fetch frees
// its entry so the next request retries instead of being served the rejection.
const cache = new LRUMap<
  number,
  { at: number; promise: Promise<Field> }
>({ maxSize: 64 });

const cachedField = (iteration: number) => {
  const cached = cache.get(iteration);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.promise;
  const promise = loadField(iteration);
  const entry = { at: Date.now(), promise };
  cache.set(iteration, entry);
  promise.catch(() => {
    if (cache.get(iteration) === entry) cache.delete(iteration);
  });
  return promise;
};

// Project the players into a ranked field for one board, best first. Daily
// keeps only players with a ranked run; PB keeps everyone. A row's `time` and
// `at` are that board's value and when it was set; `secondary` is the OTHER
// board's value (null on PB for someone who only free-played).
//
// Ties break by who reached the time FIRST (`at` ascending: `pbAt` / `dailyAt`,
// each the earliest run at that best, the SQL's MIN(created)), then by name.
export const project = (
  players: Player[],
  sort: "daily" | "pb",
): FieldEntry[] =>
  sort === "pb"
    ? [...players]
      .sort((a, b) =>
        b.pb - a.pb || a.pbAt - b.pbAt ||
        a.name.localeCompare(b.name)
      )
      .map((p) => ({
        user: p.user,
        name: p.name,
        hue: p.hue,
        time: p.pb,
        at: p.pbAt,
        secondary: p.daily,
      }))
    : players
      .filter((p): p is Player & { daily: number } => p.daily !== null)
      .sort((a, b) =>
        b.daily - a.daily || a.dailyAt - b.dailyAt ||
        a.name.localeCompare(b.name)
      )
      .map((p) => ({
        user: p.user,
        name: p.name,
        hue: p.hue,
        time: p.daily,
        at: p.dailyAt,
        secondary: p.pb,
      }));

export const standings = method(standingsBody, true)(
  async ({ userId, ...rest }) => {
    const iteration = "timeZone" in rest
      ? await (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return ensureDailyIterationId(year, month, day);
      })()
      : "iteration" in rest
      ? rest.iteration
      : await ensureDailyIterationId(rest.year, rest.month, rest.day);

    const field = await cachedField(iteration);
    const dailyField = project(field.players, "daily");
    const pbField = project(field.players, "pb");
    const daily = buildStandings(dailyField, userId);
    const pb = buildStandings(pbField, userId);

    // The viewer's `standing` on a board: their time's position in
    // [min, fieldBest], the metric the runs panel shows. The dock colours the
    // PB rank by it; the daily rank stays on its ranked percentile. Null when
    // the viewer isn't on the board.
    const withPercent = (
      me: typeof daily.me,
      top: number | undefined,
    ) =>
      me == null
        ? me
        : { ...me, percent: standing(me.time, field.min, top ?? me.time) };

    // The "until ranked" countdown tracks when the ranked field freezes; it is
    // a fact of the day, not of the PB board (free play never ranks).
    const final = field.rated || field.closesAt <= Date.now();

    return {
      iteration,
      day: field.day,
      final,
      closesAt: final ? null : field.closesAt,
      daily: {
        players: daily.players,
        me: withPercent(daily.me, dailyField[0]?.time),
        rows: daily.rows,
      },
      pb: {
        players: pb.players,
        me: withPercent(pb.me, pbField[0]?.time),
        rows: pb.rows,
      },
    };
  },
);
