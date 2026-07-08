// GET the daily standings: the podium plus the viewer's neighbourhood, with
// their own rank and the field size — the data behind the standings dock and
// its expanded sheet. Resolves "today" from the caller's timezone exactly like
// getDailySummary; the { iteration } variant serves a specific (past) day.

import { z } from "zod";
import { avatarHue } from "../../../common/avatar.ts";
import { requireDailyIterationId } from "../../db/iteration.ts";
import { getDailyStandings, getStandingsMeta } from "../../db/standings.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { LRUMap } from "../../util/LRUMap.ts";
import { buildStandings, FieldEntry } from "../../util/standings.ts";
import { method } from "../apiHelpers.ts";

const standingsBody = z.union([
  z.object({ timeZone: z.string() }),
  z.object({ iteration: z.number().min(1) }),
]);

// How long a live day's cached field is served before a refetch. Once an
// iteration is rated the field is frozen, so its entry never goes stale.
const FRESH_MS = 15_000;

// 37h after a daily's day starts, every timezone's play window has closed
// (UTC-12 leaves the day at +36h) and the rating cron picks it up — the
// "until ranked" countdown target. Kept in step with
// getUnratedClosedIterations' close-plus-pad.
const CLOSE_MS = 37 * 3_600_000;

type Field = {
  rated: boolean;
  day: [number, number, number];
  closesAt: number;
  entries: FieldEntry[];
};

const loadField = async (iteration: number): Promise<Field> => {
  const [meta, rows] = await Promise.all([
    getStandingsMeta(iteration),
    getDailyStandings(iteration),
  ]);
  return {
    rated: !!meta.rated,
    day: [meta.y, meta.m, meta.d],
    closesAt: Number(meta.dayStart) + CLOSE_MS,
    entries: rows.map((r) => ({
      // The id stays server-side — buildStandings uses it only to find the
      // viewer; rows ship name + hue instead (see common/avatar.ts).
      user: r.user,
      name: r.name ?? "anonymous",
      hue: avatarHue(r.user),
      time: Math.round(r.time * 100) / 100,
      at: Number(r.at),
    })),
  };
};

// The sorted field is identical for every viewer, so it's fetched once per
// freshness window and each request just slices its own view off the shared
// array. Rated (frozen) fields are served from cache indefinitely; the LRU
// bounds how many iterations' fields sit in memory. A failed fetch frees the
// entry so the next request retries instead of being served the rejection.
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
      // Guarded delete: only evict if the entry is still this fetch.
      if (cache.get(iteration) === entry) cache.delete(iteration);
    },
  );
  return promise;
};

export const standings = method(standingsBody, true)(
  async ({ userId, ...rest }) => {
    const iteration = "timeZone" in rest
      ? await (() => {
        const { year, month, day } = dailyParts(rest.timeZone);
        return requireDailyIterationId(year, month, day);
      })()
      : rest.iteration;

    const field = await cachedField(iteration);
    const { players, me, rows } = buildStandings(field.entries, userId);

    // Final once rated OR once the close has passed: the field is frozen at
    // the close either way — the rated flag only lags it by the cron's sweep
    // (and legacy iterations from before the flag existed never get it).
    const final = field.rated || field.closesAt <= Date.now();

    return {
      iteration,
      day: field.day,
      players,
      final,
      closesAt: final ? null : field.closesAt,
      me,
      rows,
    };
  },
);
