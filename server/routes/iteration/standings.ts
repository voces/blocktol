// GET the standings: the podium plus the viewer's neighbourhood, with their own
// rank and the field size — the data behind the standings dock and its expanded
// sheet. Resolves "today" from the caller's timezone exactly like
// getDailySummary; the { iteration } variant serves a specific (past) day.
//
// Two sorts share the sheet: "daily" ranks the day's best builds (rows carry
// each player's all-time PB as the secondary line); "pb" ranks every player's
// all-time best (rows carry their time on the viewed day). The client toggles
// between them; the dock always reads the daily board.

import { z } from "zod";
import { avatarHue } from "../../../common/avatar.ts";
import { requireDailyIterationId } from "../../db/iteration.ts";
import {
  getDailyStandings,
  getPbForUsers,
  getPbStandings,
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
// The global PB board changes slowly and is shared by every viewer, so it's
// held a little longer.
const PB_FRESH_MS = 60_000;

// 37h after a daily's day starts, every timezone's play window has closed
// (UTC-12 leaves the day at +36h) and the rating cron picks it up — the
// "until ranked" countdown target. Kept in step with
// getUnratedClosedIterations' close-plus-pad.
const CLOSE_MS = 37 * 3_600_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

type DailyField = {
  rated: boolean;
  day: [number, number, number];
  closesAt: number;
  entries: FieldEntry[]; // secondary = each player's all-time PB
  dayTime: Map<string, number>; // player id -> their best time that day
};

// The day's field with each row's PB baked in (one scoped getPbForUsers per
// load, not per request), so the frequent dock/sheet reads are pure slices.
const loadDailyField = async (iteration: number): Promise<DailyField> => {
  const [meta, rows] = await Promise.all([
    getStandingsMeta(iteration),
    getDailyStandings(iteration),
  ]);
  const pb = await getPbForUsers(rows.map((r) => r.user));
  const entries = rows.map((r): FieldEntry => {
    const time = round2(r.time);
    return {
      // The id stays server-side — buildStandings uses it only to find the
      // viewer and to attach secondaries; rows ship name + hue instead.
      user: r.user,
      name: r.name ?? "anonymous",
      hue: avatarHue(r.user),
      time,
      at: Number(r.at),
      // PB is all-time, so ≥ the day's time; fall back to the day's time.
      secondary: round2(pb.get(r.user) ?? r.time),
    };
  });
  return {
    rated: !!meta.rated,
    day: [meta.y, meta.m, meta.d],
    closesAt: Number(meta.dayStart) + CLOSE_MS,
    entries,
    dayTime: new Map(entries.map((e) => [e.user, e.time])),
  };
};

// The global PB field (all players, best-first), secondary left for the route
// to attach per-window (each row's time on the viewed day).
const loadPbField = async (): Promise<FieldEntry[]> => {
  const rows = await getPbStandings();
  return rows.map((r) => ({
    user: r.user,
    name: r.name ?? "anonymous",
    hue: avatarHue(r.user),
    time: round2(r.pb),
    at: 0,
  }));
};

// Each sorted field is identical for every viewer, so it's fetched once per
// freshness window and each request slices its own view. Rated (frozen) days
// are served indefinitely; the LRU bounds how many days sit in memory. A failed
// fetch frees the entry so the next request retries rather than being served
// the rejection.
const dailyCache = new LRUMap<
  number,
  { at: number; rated: boolean; promise: Promise<DailyField> }
>({ maxSize: 64 });

const cachedDaily = (iteration: number) => {
  const cached = dailyCache.get(iteration);
  if (cached && (cached.rated || Date.now() - cached.at < FRESH_MS)) {
    return cached.promise;
  }
  const promise = loadDailyField(iteration);
  const entry = { at: Date.now(), rated: false, promise };
  dailyCache.set(iteration, entry);
  promise.then(
    (field) => {
      entry.rated = field.rated;
    },
    () => {
      if (dailyCache.get(iteration) === entry) dailyCache.delete(iteration);
    },
  );
  return promise;
};

// The single global PB field, refreshed on its own (longer) window.
let pbEntry: { at: number; promise: Promise<FieldEntry[]> } | null = null;
const cachedPb = () => {
  if (pbEntry && Date.now() - pbEntry.at < PB_FRESH_MS) return pbEntry.promise;
  const entry = { at: Date.now(), promise: loadPbField() };
  pbEntry = entry;
  entry.promise.catch(() => {
    if (pbEntry === entry) pbEntry = null;
  });
  return entry.promise;
};

export const standings = method(standingsBody, true)(
  async ({ userId, sort = "daily", ...rest }) => {
    const iteration = "timeZone" in rest
      ? await (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return requireDailyIterationId(year, month, day);
      })()
      : rest.iteration;

    const daily = await cachedDaily(iteration);

    if (sort === "pb") {
      const pbField = await cachedPb();
      const { players, me, rows, rowUsers, meUser } = buildStandings(
        pbField,
        userId,
      );
      // Attach each shown row's time on the viewed day (null if they didn't
      // play it) — only the ~window players, from the day's cached map.
      rows.forEach((r, i) => {
        r.secondary = daily.dayTime.get(rowUsers[i]) ?? null;
      });
      if (me) me.secondary = meUser ? daily.dayTime.get(meUser) ?? null : null;
      return {
        iteration,
        day: daily.day,
        sort,
        players,
        // PB is all-time — it never "locks", so no countdown (final/closesAt
        // are day concepts).
        final: true,
        closesAt: null,
        me,
        rows,
      };
    }

    const { players, me, rows } = buildStandings(daily.entries, userId);
    // Final once rated OR once the close has passed: the field is frozen at the
    // close either way — the rated flag only lags it by the cron's sweep.
    const final = daily.rated || daily.closesAt <= Date.now();
    return {
      iteration,
      day: daily.day,
      sort,
      players,
      final,
      closesAt: final ? null : daily.closesAt,
      me,
      rows,
    };
  },
);
