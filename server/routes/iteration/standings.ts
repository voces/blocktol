// GET the standings: the podium plus the viewer's neighbourhood, with their own
// rank and the field size — the data behind the standings dock and its expanded
// sheet. Resolves "today" from the caller's timezone exactly like
// getDailySummary; the { iteration } variant serves a specific (past) day.
//
// One request, one cached field, two boards of the SAME day's runs — returned
// together so the client toggles instantly without a second round trip:
//   - "daily" ranks the players with a ranked daily run by that time (rows
//     carry their best build that day as the secondary line);
//   - "pb" ranks EVERYONE with a non-void run by their best build that day
//     (rows carry their ranked daily time, or null if they only free-played).
// Each board is fully ranked/windowed server-side (ids never reach the wire);
// the client just renders whichever the dock/sheet has active.

import { z } from "zod";
import { avatarHue } from "../../../common/avatar.ts";
import { standing } from "../../../common/standing.ts";
import { requireDailyIterationId } from "../../db/iteration.ts";
import {
  getDailyStandings,
  getIterationBests,
  getStandingsMeta,
} from "../../db/standings.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { LRUMap } from "../../util/LRUMap.ts";
import { buildStandings, FieldEntry } from "../../util/standings.ts";
import { method } from "../apiHelpers.ts";

// "today" (resolved from the caller's timezone), a specific iteration, or a
// calendar day (the `/YYYYMMDD` permalink / notification deep-link, which knows
// the date but not the id). No sort — the response carries both boards.
const standingsBody = z.union([
  z.object({ timeZone: z.string() }),
  z.object({ iteration: z.number().min(1) }),
  z.object({
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
]);

// How long a cached day's field is served before a refetch. Applies to every
// day, not just live ones: the field now counts free play (the PB sort), and a
// closed day's PB can still move when someone replays that old board — so no
// day is truly frozen, and none is cached indefinitely.
const FRESH_MS = 15_000;

// 37h after a daily's day starts, every timezone's play window has closed
// (UTC-12 leaves the day at +36h) and the rating cron picks it up — the
// "until ranked" countdown target. Kept in step with
// getUnratedClosedIterations' close-plus-pad.
const CLOSE_MS = 37 * 3_600_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// One player on the day, carrying both boards' values and when each was set:
// their best build that day counting any non-void run (`pb`/`pbAt`, the PB
// sort's value + timestamp / the daily board's secondary) and their best
// RANKED daily run (`daily`/`dailyAt`, the daily sort's value + timestamp /
// the PB board's secondary — null/0 if they only free-played that day). The
// route projects this into a FieldEntry per sort, each with its own timestamp.
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

// The day's field: everyone with a non-void run that day (getIterationBests),
// each carrying their best-that-day (pb) and, where they made ranked attempts,
// their best ranked time + when (getDailyStandings). Both queries scope to this
// iteration, so a day the viewer only free-played still populates the PB board
// even though the ranked daily field is empty.
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
    // The id stays server-side — buildStandings uses it only to find the viewer
    // and to attach secondaries; rows ship name + hue instead.
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

// Each day's field is identical for every viewer, so it's fetched once per
// freshness window and each request slices its own view. Every day expires
// after FRESH_MS (a closed day's PB can still change via replays); the LRU
// bounds how many sit in memory. A failed fetch frees the entry so the next
// request retries rather than being served the rejection.
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

// Project the day's players into a ranked field for one sort, best first.
// Daily ranks only those with a ranked run (`daily` non-null) by that time; PB
// ranks EVERYONE with a non-void run by their best build that day. Each row's
// `time` is the sort's value, `at` its timestamp (when that build/run was set),
// and `secondary` the OTHER board's value (null on the PB board for someone who
// only free-played — rendered "—").
//
// Ties on the ranked value break by who reached it FIRST (`at` ascending) — the
// PB board on `pbAt`, the daily board on `dailyAt` — then by name as a stable
// final fallback. Both timestamps are the earliest run at that best (the SQL's
// MIN(created)), so "first to the time" is honoured on both boards.
export const project = (players: Player[], sort: "daily" | "pb"): FieldEntry[] =>
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
        return requireDailyIterationId(year, month, day);
      })()
      : "iteration" in rest
      ? rest.iteration
      : await requireDailyIterationId(rest.year, rest.month, rest.day);

    const field = await cachedField(iteration);
    const dailyField = project(field.players, "daily");
    const pbField = project(field.players, "pb");
    const daily = buildStandings(dailyField, userId);
    const pb = buildStandings(pbField, userId);

    // The viewer's standing on a board — their best time's position in
    // [min, fieldBest], the same metric (and colour) the runs panel shows for a
    // run. The dock colours the PB rank by this (a great build reads green even
    // at #2 in a small field), while the daily rank stays on its ranked
    // percentile. Attached to both `me`s; null when the viewer isn't on it.
    const withPercent = (
      me: typeof daily.me,
      top: number | undefined,
    ) =>
      me == null
        ? me
        : { ...me, percent: standing(me.time, field.min, top ?? me.time) };

    // The "until ranked" countdown is a daily-board concept — it tracks when
    // the ranked field freezes, locking once the day is rated (or its close has
    // passed). It's a top-level fact of the day; the PB board counts free play,
    // which never "ranks", so it never shows a countdown regardless.
    const final = field.rated || field.closesAt <= Date.now();

    // rowUsers/meUser (the parallel id arrays) are deliberately dropped — the
    // raw id is the bearer credential and must never reach the wire.
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
