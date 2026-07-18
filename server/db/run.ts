import { Point } from "../../common/types.ts";
import { deserializeRun, serializeRun } from "../util/run.ts";
import { raw, sql, sqlOnce } from "./query.ts";

// Every run starts void. A daily attempt counts once its maze is built
// (updateCurrentRun clears void for ranked runs); a free-play run counts only
// once it actually executes (commitRun). Navigating away before either leaves
// the run void — i.e. abandoned — so no explicit abandon call is needed for
// free play.
//
// `ranked` — this run is one of the daily's three attempts — is recorded here
// and only here: among the user's first three runs on the iteration, AND the
// iteration is the daily for the user's claimed local day (year/month/day come
// from the request's timezone). It cannot be inferred later from `created`: a
// daily's legal window spans ~50 hours of server time (UTC+14 mornings through
// UTC-12 midnights), so only the start request knows. `daily` is a different
// flag — the single *counted* result — seeded on the first attempt and
// re-pointed at the best ranked run as builds save (see updateCurrentRun).
//
// The NOT EXISTS guard dedupes near-simultaneous starts (a double-fired event,
// two tabs racing boot): the @priorRuns check and the INSERT are separate
// statements, so two concurrent batches could otherwise both insert — spending
// two attempts at once. 2s covers a race without ever blocking a legitimate
// next attempt (the shortest run outlasts it) or an early tap-to-start.
export const startRun = (
  iteration: number,
  user: string,
  minTime: number,
  year: number,
  month: number,
  day: number,
) =>
  // sqlOnce: the INSERT isn't idempotent — a retry after a lost response would
  // create a second run, silently spending an extra daily attempt.
  sqlOnce`
    SET @priorRuns := NULL;
    SET @isDaily := FALSE;

    SELECT @priorRuns := COUNT(1)
    FROM run
    WHERE user = ${user}
    AND iteration = ${iteration};

    SELECT @isDaily := (id = ${iteration})
    FROM iteration
    WHERE YEAR(created) = ${year}
      AND MONTH(created) = ${month}
      AND DAY(created) = ${day}
    ORDER BY id LIMIT 1;

    INSERT INTO run (user, iteration, time, data, void, daily, ranked)
    SELECT ${user}, ${iteration}, ${minTime}, '', TRUE,
      (@priorRuns = 0) AND @isDaily,
      (@priorRuns < 3) AND @isDaily
    FROM DUAL
    WHERE NOT EXISTS (
      SELECT 1 FROM run
      WHERE user = ${user}
        AND iteration = ${iteration}
        AND TIMESTAMPDIFF(SECOND, created, NOW()) < 2
    );`;

// Mark the caller's current free-play run non-void once it actually executes
// (timer expiry or an explicit start). Free-play runs are inserted void and only
// counted here, so leaving before the run runs keeps it void (abandoned).
// ranked = FALSE scopes it to free play — daily attempts are already committed
// on build.
export const commitRun = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET void = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND ranked = FALSE
    ORDER BY created DESC
    LIMIT 1;
  `;

// Free play's single-request commit: insert the executed run directly, non-void,
// with the server-computed time. Free play no longer calls startRun/updateRun —
// the client builds the maze and enforces the 60s window locally (see the client
// run loop), so this is the only row a free-play attempt ever writes. void = FALSE
// (it's committing because it executed), ranked = FALSE and daily = FALSE (free
// play never counts as one of the day's three ranked attempts).
//
// sqlOnce + a NOT EXISTS guard on client_id makes the write idempotent: commitRun
// is retryable now, so a retry after a lost response re-runs this exact INSERT and
// the guard drops the duplicate. clientId is the client's per-attempt id.
//
// Returns the run's server-assigned `created` as ms epoch — the same
// UNIX_TIMESTAMP(created) * 1000 the pin query matches on. The client shows the
// just-executed run in its panel optimistically, before any re-stage refetches
// the authoritative list; handing back the real created lets a pin on that row
// match the stored row (a client Date.now() stamp — millisecond precision off
// the player's own clock — never would). The trailing SELECT reads it back for
// the row whether this call inserted it or an idempotent retry found it already
// there, so the whole batch stays retry-safe.
export const insertFreePlayRun = (
  user: string,
  iteration: number,
  time: number,
  blocks: (Point & { thunder?: boolean })[],
  clientId: string,
) =>
  sqlOnce<[unknown, { created: number }[]]>`
    INSERT INTO run (user, iteration, time, data, void, daily, ranked, client_id)
    SELECT ${user}, ${iteration}, ${time}, ${
    serializeRun(blocks.map((b) => ({ ...b, player: true })))
  }, FALSE, FALSE, FALSE, ${clientId}
    FROM DUAL
    WHERE NOT EXISTS (
      SELECT 1 FROM run
      WHERE user = ${user}
        AND iteration = ${iteration}
        AND client_id = ${clientId}
    );

    SELECT UNIX_TIMESTAMP(created) * 1000 created
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND client_id = ${clientId}
    LIMIT 1;
  `.then((r) => r?.[1]?.[0]?.created ?? null);

// Save the caller's in-progress build (latest run, within the 60s window).
// Whether the save also commits comes off the run row itself: `ranked` was
// recorded at start (see startRun), the only moment the timezone-aware daily
// check can be made. A ranked attempt commits on build (its built maze is the
// spent attempt's result), clearing void and re-pointing `daily` — the single
// counted result — at the best ranked run; free play leaves void alone (it
// only counts once it executes — see commitRun) and skips the reassignment. A
// single multi-statement query runs on one connection, so @ranked is visible
// to every statement in the batch.
//
// Returns whether the save landed: `saved` is false when the run's 60s window
// has closed (or there's no run at all), so the route can tell the client its
// edit was NOT persisted instead of implying success. Checked off the row's
// own age rather than the UPDATE's changedRows, which is also 0 for a save
// carrying identical data.
//
// The whole batch rides one transaction: a failure between the save and the
// daily re-pointing must not leave void cleared with the counted-result flags
// half-reassigned.
export const updateCurrentRun = (
  user: string,
  time: number,
  blocks: (Point & { thunder?: boolean; player?: boolean })[],
  iteration: number,
) =>
  sql<
    [
      unknown,
      unknown,
      { ranked: number; fresh: number }[] | undefined,
      ...unknown[],
    ]
  >`
    START TRANSACTION;

    SET @ranked := FALSE;

    SELECT @ranked := ranked ranked,
           TIMESTAMPDIFF(SECOND, created, NOW()) < 60 fresh
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
    ORDER BY created DESC LIMIT 1;

    UPDATE run
    SET time = ${time}, data = ${
    serializeRun(blocks)
  }, void = void AND NOT @ranked
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND TIMESTAMPDIFF(SECOND, created, NOW()) < 60
    ORDER BY created DESC LIMIT 1;

    UPDATE run
    SET daily = FALSE
    WHERE @ranked
      AND user = ${user}
      AND iteration = ${iteration}
      AND ranked = TRUE;

    UPDATE run
    SET daily = TRUE
    WHERE @ranked
      AND user = ${user}
      AND iteration = ${iteration}
      AND ranked = TRUE
      AND time = (
        SELECT MAX(time)
        FROM (
          SELECT time
          FROM run
          WHERE user = ${user}
            AND iteration = ${iteration}
            AND ranked = TRUE
        ) t1
      )
    ORDER BY created ASC LIMIT 1;

    COMMIT;`.then((r) => ({
    saved: !!r?.[2]?.[0]?.fresh,
  }));

// Pin (or unpin) the caller's runs on an iteration. The runs panel merges runs
// that built the identical maze into one row, so a pin toggles the whole
// maze-group at once: the caller passes every member run's creation time
// (`createds`, ms epoch) and they flip together, keeping the group's pinned
// state consistent however the merge later picks its representative row.
//
// Matched on UNIX_TIMESTAMP(created) * 1000 — the same ms the client renders and
// sends back (getUserStats reads `joined` the same way) — because the run table
// has no primary key. `created` is second-precision, so this is an exact integer
// match; a rare equal-second tie flips both, which is harmless (they'd merge into
// one row anyway, or are indistinguishable to the player). Idempotent (sets an
// absolute value), so the api layer may safely retry it.
export const setRunPinned = (
  user: string,
  iteration: number,
  createds: number[],
  pinned: boolean,
) => {
  if (createds.length === 0) return Promise.resolve();
  return sql`
    UPDATE run
    SET pinned = ${pinned}
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND UNIX_TIMESTAMP(created) * 1000 IN (${createds});
  `;
};

// The user's best non-void build on an iteration EXCLUDING their most recent run
// — i.e. their PB *before* the run that just landed. The lost-top check reads it
// to tell whether the field's leaders were already ahead of this player before
// their new build, so a player merely extending an existing lead never fires a
// spurious "you lost #1" at the runners-up. Null when they had no prior build.
export const getUserPrevBest = (user: string, iteration: number) =>
  sql<{ prev: number | null }[]>`
    SELECT MAX(time) prev
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND void = FALSE
      AND created < (
        SELECT MAX(created) FROM run
        WHERE user = ${user} AND iteration = ${iteration}
      );
  `.then((r) => r[0]?.prev ?? null);

// `rankedOnly` filters to the daily's three attempts — the resume path uses it
// to find an in-progress attempt. Filtering on `daily` here would be wrong: an
// in-progress attempt 2/3 only holds daily = TRUE while it happens to beat the
// earlier attempts (`daily` marks the counted result, not ranked-ness).
export const getLatestRun = (
  user: string,
  iteration: number,
  rankedOnly?: boolean,
) =>
  sql<
    | { iteration: number; created: string; data: string }[]
    | undefined
  >`
    SELECT iteration, created, data
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      ${raw(rankedOnly ? "AND ranked = TRUE" : "")}
    ORDER BY created DESC LIMIT 1;
  `.then((r) =>
    r?.[0]
      ? ({
        iteration: r[0].iteration,
        created: r[0].created,
        maze: deserializeRun(r[0].data),
      })
      : null
  );
