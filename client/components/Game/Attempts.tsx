import { h } from "preact";
import { useContext, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileBand,
  standingColor,
} from "../../../common/percentileColor.ts";
import { MessageMap } from "../../api.ts";
import { GameStateContext } from "./useGameState.ts";

type Attempt = MessageMap["getDailySummary"]["attempts"][number];

type Sort = "best" | "recent";

// Persist the runs sort across visits. Defaults to best for anything unset or
// unrecognized.
const SORT_KEY = "runsSort";
const storedSort = (): Sort =>
  localStorage.getItem(SORT_KEY) === "recent" ? "recent" : "best";

// Order-independent key for a maze, so the row whose maze is currently on the
// board can be matched however its blocks happen to be ordered.
const mazeKey = (
  maze: ReadonlyArray<{ x: number; y: number; thunder?: boolean }>,
) =>
  JSON.stringify(
    [...maze]
      .map((b) => [b.x, b.y, b.thunder ? 1 : 0])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  );

// When a run happened, from the viewer's clock: relative (Xs/Xm/Xh ago) if it's
// today OR within the last 8 hours — so an 11pm run still reads "3h ago" at 2am —
// otherwise the date.
const formatWhen = (created: number) => {
  const diff = Date.now() - created;
  const when = new Date(created);
  const now = new Date();
  const today = when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() && when.getDate() === now.getDate();

  if (today || diff < 8 * 3_600_000) {
    const s = Math.max(0, Math.floor(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  }
  return when.toLocaleDateString(undefined, { dateStyle: "medium" });
};

// Every run on the viewed maze (ranked and free play, fed by startRun / getBoard
// / getDailySummary via `viewedAttempts`), each tinted to its own percentile
// band. Runs that built the identical maze are merged into one row (×N), best
// first, labelled by when they last ran. The best run carries the BEST — or
// SUPREME, when it tops the field — badge. Clicking a row re-renders that maze.
export const Attempts = () => {
  const { viewedAttempts, viewMaze, attemptsRemaining, blocks, viewing } =
    useContext(GameStateContext);
  // Local-only ordering, remembered across visits. Defaults to best (longest)
  // first; "recent" orders by when each maze last ran. Sorting only — the merged
  // rows are the same.
  const [sort, setSort] = useState<Sort>(storedSort);
  const pickSort = (mode: Sort) => {
    localStorage.setItem(SORT_KEY, mode);
    setSort(mode);
  };
  const attempts = viewedAttempts ?? [];

  // Mid-daily the list shows in a simplified form — time, when, and which is
  // your best — but WITHOUT the field-relative info (percentile colour, %,
  // SUPREME) that would anchor how players approach their remaining attempts. It
  // fills in fully once the daily is done (attemptsRemaining === 0). Nothing to
  // show on a fresh daily with no runs yet.
  const simplified = attemptsRemaining !== 0;
  if (simplified && attempts.length === 0) return null;

  // Merge runs with identical maze data (anywhere in the list, not just
  // consecutive), keeping the count and the most recent run.
  const byMaze = new Map<
    string,
    {
      attempt: Attempt;
      count: number;
      latest: number;
      supreme: boolean;
      ranked: boolean;
    }
  >();
  for (const attempt of attempts) {
    const key = JSON.stringify(attempt.maze);
    const group = byMaze.get(key);
    if (group) {
      group.count++;
      group.supreme = group.supreme || attempt.supreme;
      group.ranked = group.ranked || attempt.ranked;
      if (attempt.created > group.latest) {
        group.latest = attempt.created;
        group.attempt = attempt;
      }
    } else {
      byMaze.set(key, {
        attempt,
        count: 1,
        latest: attempt.created,
        supreme: attempt.supreme,
        ranked: attempt.ranked,
      });
    }
  }

  // Best (longest) first identifies the BEST/SUPREME row regardless of the
  // chosen order; "recent" instead orders by each maze's latest run.
  const byDuration = [...byMaze.values()].sort((a, b) =>
    b.attempt.duration - a.attempt.duration
  );
  const bestGroup = byDuration[0];
  const groups = sort === "recent"
    ? [...byMaze.values()].sort((a, b) => b.latest - a.latest)
    : byDuration;

  // The maze currently on the board when reviewing a past run (viewMaze makes it
  // the local blocks) — used to flag its row as being viewed.
  const viewingKey = viewing
    ? mazeKey(
      blocks.filter((b) => b.local).map((b) => ({
        x: b.x,
        y: b.y,
        thunder: b.thunder,
      })),
    )
    : null;

  return (
    <div class="attempts">
      <div class="attempts__head">
        <div class="section-title">Runs</div>
        {groups.length > 1 && (
          <div class="attempts__sort" role="group" aria-label="Sort runs">
            {(["recent", "best"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                class={"attempts__sort-btn tapc" +
                  (sort === mode ? " attempts__sort-btn--active" : "")}
                aria-pressed={sort === mode}
                onClick={() => pickSort(mode)}
              >
                {mode === "recent" ? "Recent" : "Best"}
              </button>
            ))}
          </div>
        )}
      </div>
      {groups.length
        ? (
          <div class="attempts__list">
            {groups.map((group, i) => {
              const { attempt } = group;
              // Full: continuous ramp colour, with two standings lifted off it —
              // supreme gold (took the record) and, one step below, peak green-
              // yellow (tied the field's top but didn't take it outright).
              // Simplified: a neutral band so the time reads without signalling
              // standing.
              const supreme = !simplified && group.supreme;
              const peak = !simplified && !group.supreme &&
                attempt.percent === 1;
              const band = simplified
                ? "var(--color)"
                : group.supreme
                ? "var(--gold)"
                : peak
                ? "var(--peak)"
                : standingColor(attempt.percent);
              const isBest = group === bestGroup;
              const isViewing = viewingKey != null &&
                mazeKey(attempt.maze) === viewingKey;
              // Mid-daily (simplified) the rows are inert: reviewing a past
              // maze would replace the live attempt's board, and even the
              // affordance (pointer, hover, title) would invite wandering off
              // mid-run — matching how the calendar and profile hide entirely.
              const clickable = !simplified;
              return (
                <div
                  class={"attempts__row band-card" +
                    (clickable ? " attempts__row--clickable tapc" : "") +
                    (supreme ? " attempts__row--glow" : "") +
                    (isViewing ? " attempts__row--viewing" : "")}
                  key={i}
                  style={{ "--band": band }}
                  title={clickable ? "View this maze" : undefined}
                  onClick={clickable
                    ? () => {
                      viewMaze(attempt.maze);
                      // Mobile scrolls the board out of view under the runs
                      // list; snap back up to it (instant) so the reviewed
                      // maze is seen.
                      document.querySelector(".game")?.scrollTo({ top: 0 });
                    }
                    : undefined}
                >
                  <span class="attempts__time mono">{attempt.duration}s</span>
                  <div class="attempts__meta">
                    <div class="attempts__kind">
                      {formatWhen(group.latest)}
                      {group.count > 1 && (
                        <span class="attempts__count">×{group.count}</span>
                      )}
                      {!simplified && group.ranked && (
                        <span class="attempts__daily">Daily</span>
                      )}
                      {isBest && (!simplified || groups.length > 1) && (
                        <span class="attempts__badge">
                          {supreme ? "SUPREME" : peak ? "RECORD" : "BEST"}
                        </span>
                      )}
                    </div>
                    {!simplified && (
                      <div class="attempts__sub">
                        <span>{formatPercentile(attempt.percent)}%</span>
                        {group.ranked && attempt.percentile != null && (
                          // Coloured by the percentile ITSELF — the row's band
                          // is the standing (% of the field's range), a
                          // different metric, and inheriting it could paint a
                          // p100 red.
                          <span
                            class="attempts__pct"
                            style={{
                              "--pct": percentileBand(attempt.percentile),
                            }}
                          >
                            p{formatPercentile(attempt.percentile)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {isViewing && <span class="attempts__viewing">viewing</span>}
                </div>
              );
            })}
          </div>
        )
        : <div class="attempts__empty">No runs yet</div>}
    </div>
  );
};
