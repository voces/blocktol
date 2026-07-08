// GET the standings: the podium plus the viewer's neighbourhood, with their own
// rank and the field size — the data behind the standings dock and its expanded
// sheet. Resolves "today" from the caller's timezone exactly like
// getDailySummary; the { iteration } variant serves a specific (past) day.
//
// One field, two sorts of the SAME day's players: "daily" ranks by the day's
// best build (rows carry each player's all-time PB as the secondary line);
// "pb" re-ranks the very same players by their all-time best (rows carry that
// day's time). Both report the same player count; the client toggles between
// them, and the dock reflects whichever is active.

import { z } from "zod";
import { avatarHue } from "../../../common/avatar.ts";
import { requireDailyIterationId } from "../../db/iteration.ts";
import {
  getDailyStandings,
  getPbForUsers,
  getStandingsMeta,
} from "../../db/standings.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { LRUMap } from "../../util/LRUMap.ts";
import { buildStandings, FieldEntry } from "../../util/standings.ts";
import { method } from "../apiHelpers.ts";

const standingsBody = z.intersection(
  z.union([
    z.object({ timeZone: z.string() }),
    z.object({ iteration: z.number().min(1) }),
  ]),
  z.object({ sort: z.enum(["daily", "pb"]).optional() }),
);

// How long a live day's cached field is served before a refetch. Once an
// iteration is rated the field is frozen, so its entry never goes stale.
const FRESH_MS = 15_000;

// 37h after a daily's day starts, every timezone's play window has closed
// (UTC-12 leaves the day at +36h) and the rating cron picks it up — the
// "until ranked" countdown target. Kept in step with
// getUnratedClosedIterations' close-plus-pad.
const CLOSE_MS = 37 * 3_600_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// One row of the day's field: the two rankable values (that day's best build,
// and the player's all-time PB) plus identity. The route projects this into a
// FieldEntry per sort.
type Player = {
  user: string;
  name: string;
  hue: number;
  daily: number;
  pb: number;
  at: number;
};

type Field = {
  rated: boolean;
  day: [number, number, number];
  closesAt: number;
  players: Player[]; // best-first by the day's time (getDailyStandings order)
};

// The day's players, each with their all-time PB folded in (one scoped
// getPbForUsers per load, not per request), so the frequent dock/sheet reads
// are pure in-memory projections.
const loadField = async (iteration: number): Promise<Field> => {
  const [meta, rows] = await Promise.all([
    getStandingsMeta(iteration),
    getDailyStandings(iteration),
  ]);
  // PB as of THIS day — bounded to this iteration and earlier, so a past day's
  // board shows historical PBs, not ones set later.
  const pb = await getPbForUsers(rows.map((r) => r.user), iteration);
  return {
    rated: !!meta.rated,
    day: [meta.y, meta.m, meta.d],
    closesAt: Number(meta.dayStart) + CLOSE_MS,
    players: rows.map((r) => {
      const daily = round2(r.time);
      return {
        // The id stays server-side — buildStandings uses it only to find the
        // viewer and to attach secondaries; rows ship name + hue instead.
        user: r.user,
        name: r.name ?? "anonymous",
        hue: avatarHue(r.user),
        daily,
        // PB is all-time, so ≥ the day's time; fall back to the day's time.
        pb: round2(pb.get(r.user) ?? daily),
        at: Number(r.at),
      };
    }),
  };
};

// Each day's field is identical for every viewer, so it's fetched once per
// freshness window and each request slices its own view. Rated (frozen) days
// are served indefinitely; the LRU bounds how many sit in memory. A failed
// fetch frees the entry so the next request retries rather than being served
// the rejection.
const cache = new LRUMap<
  number,
  { at: number; rated: boolean; promise: Promise<Field> }
>({ maxSize: 64 });

const cachedField = (iteration: number) => {
  const cached = cache.get(iteration);
  if (cached && (cached.rated || Date.now() - cached.at < FRESH_MS)) {
    return cached.promise;
  }
  const promise = loadField(iteration);
  const entry = { at: Date.now(), rated: false, promise };
  cache.set(iteration, entry);
  promise.then(
    (field) => {
      entry.rated = field.rated;
    },
    () => {
      if (cache.get(iteration) === entry) cache.delete(iteration);
    },
  );
  return promise;
};

// Project the day's players into a ranked field for the chosen sort. Daily
// keeps the query's time-desc order; PB re-sorts the same players by their
// all-time best (ties broken by the day's time, then name, for a stable
// window). The ranked value is `time`; the other is `secondary`.
const project = (players: Player[], sort: "daily" | "pb"): FieldEntry[] =>
  sort === "pb"
    ? [...players]
      .sort((a, b) =>
        b.pb - a.pb || b.daily - a.daily || a.name.localeCompare(b.name)
      )
      .map((p) => ({
        user: p.user,
        name: p.name,
        hue: p.hue,
        time: p.pb,
        at: p.at,
        secondary: p.daily,
      }))
    : players.map((p) => ({
      user: p.user,
      name: p.name,
      hue: p.hue,
      time: p.daily,
      at: p.at,
      secondary: p.pb,
    }));

export const standings = method(standingsBody, true)(
  async ({ userId, sort = "daily", ...rest }) => {
    const iteration = "timeZone" in rest
      ? await (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return requireDailyIterationId(year, month, day);
      })()
      : rest.iteration;

    const field = await cachedField(iteration);
    const { players, me, rows } = buildStandings(
      project(field.players, sort),
      userId,
    );

    // The daily board locks once its day is rated (or its close has passed —
    // the field is frozen at the close either way). The PB board is all-time,
    // so it never locks: no countdown.
    const final = sort === "pb" ||
      field.rated || field.closesAt <= Date.now();

    return {
      iteration,
      day: field.day,
      sort,
      players,
      final,
      closesAt: sort === "daily" && !final ? field.closesAt : null,
      me,
      rows,
    };
  },
);
