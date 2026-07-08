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
  getIterationBests,
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

// One player on the day: their best build that day counting any non-void run
// (`pb`, the PB sort's value / the daily board's secondary) and their best
// RANKED daily run (`daily`, the daily sort's value / the PB board's
// secondary — null if they only free-played that day), plus when the daily
// best was set. The route projects this into a FieldEntry per sort.
type Player = {
  user: string;
  name: string;
  hue: number;
  daily: number | null;
  pb: number;
  at: number;
};

type Field = {
  rated: boolean;
  day: [number, number, number];
  closesAt: number;
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
    // The id stays server-side — buildStandings uses it only to find the viewer
    // and to attach secondaries; rows ship name + hue instead.
    players: bests.map((b) => {
      const d = daily.get(b.user);
      return {
        user: b.user,
        name: b.name ?? "anonymous",
        hue: avatarHue(b.user),
        daily: d ? d.time : null,
        pb: round2(b.best),
        at: d ? d.at : 0,
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

// Project the day's players into a ranked field for the chosen sort, best
// first. Daily ranks only those with a ranked run (`daily` non-null) by that
// time; PB ranks EVERYONE with a non-void run by their best build that day.
// The ranked value is `time`; the other board's value is `secondary` (null on
// the PB board for someone who only free-played — rendered "—").
const project = (players: Player[], sort: "daily" | "pb"): FieldEntry[] =>
  sort === "pb"
    ? [...players]
      .sort((a, b) =>
        b.pb - a.pb || (b.daily ?? 0) - (a.daily ?? 0) ||
        a.name.localeCompare(b.name)
      )
      .map((p) => ({
        user: p.user,
        name: p.name,
        hue: p.hue,
        time: p.pb,
        at: p.at,
        secondary: p.daily,
      }))
    : players
      .filter((p): p is Player & { daily: number } => p.daily !== null)
      .sort((a, b) =>
        b.daily - a.daily || a.at - b.at || a.name.localeCompare(b.name)
      )
      .map((p) => ({
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

    // The "until ranked" countdown is a daily-board concept — it tracks when
    // the ranked field freezes. It locks once the day is rated (or its close
    // has passed — frozen at the close either way). The PB board counts free
    // play too, which never "ranks", so it shows no countdown.
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
