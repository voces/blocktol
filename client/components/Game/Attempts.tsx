import { h } from "preact";
import { useContext, useState } from "preact/compat";
import { formatSeconds } from "../../../common/format.ts";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileBand,
  standingColor,
} from "../../../common/percentileColor.ts";
import { api, MessageMap } from "../../api.ts";
import { GameStateContext } from "./useGameState.ts";

type Attempt = MessageMap["getDailySummary"]["attempts"][number];

// A filled (pinned) or outline (unpinned) pushpin — the per-row pin toggle. The
// same glyph both states so only its fill changes, reading as one control.
const PinIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M9 3h6a1 1 0 0 1 .3 1.95L15 5v5l2.4 2.4a1 1 0 0 1 .3.7V14a1 1 0 0 1-1 1h-4v5a1 1 0 0 1-2 0v-5H7a1 1 0 0 1-1-1v-.9a1 1 0 0 1 .3-.7L9 10V5l-.3-.05A1 1 0 0 1 9 3Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width={filled ? 0 : 1.6}
      stroke-linejoin="round"
    />
  </svg>
);

type Sort = "best" | "recent";

// Persist the runs sort across visits. Defaults to best for anything unset or
// unrecognized. `reversed` flips whichever sort is active — tapping the active
// tab again inverts it, so Best can show shortest-first and Recent oldest-first;
// it applies to the CURRENT sort, so switching tabs resets to that sort's
// default direction.
const SORT_KEY = "runsSort";
const DIR_KEY = "runsSortReversed";
const storedSort = (): Sort =>
  localStorage.getItem(SORT_KEY) === "recent" ? "recent" : "best";
const storedReversed = (): boolean => localStorage.getItem(DIR_KEY) === "1";

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
  const {
    viewedAttempts,
    setViewedAttempts,
    viewMaze,
    attemptsRemaining,
    blocks,
    viewing,
    iteration,
  } = useContext(GameStateContext);
  // Local-only ordering, remembered across visits. Defaults to best (longest)
  // first; "recent" orders by when each maze last ran. Sorting only — the merged
  // rows are the same. Tapping the active tab flips its direction (`reversed`).
  const [sort, setSort] = useState<Sort>(storedSort);
  const [reversed, setReversed] = useState<boolean>(storedReversed);
  const pickSort = (mode: Sort) => {
    // Re-tapping the active sort inverts it; picking a different sort starts
    // from that sort's default direction.
    const nextReversed = mode === sort ? !reversed : false;
    localStorage.setItem(SORT_KEY, mode);
    localStorage.setItem(DIR_KEY, nextReversed ? "1" : "0");
    setSort(mode);
    setReversed(nextReversed);
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
      // Stable per-group identity (the maze key) used as the render key, so a
      // row keeps its DOM node when the list re-sorts — a pin toggle floats its
      // row to the top without focus staying pinned to the old array index.
      id: string;
      attempt: Attempt;
      count: number;
      latest: number;
      supreme: boolean;
      ranked: boolean;
      // Pinned if ANY run in the maze-group is pinned; `createds` collects every
      // member's run time so a toggle flips them together (keeping the group's
      // pinned state consistent however the merge later picks its representative).
      pinned: boolean;
      createds: number[];
    }
  >();
  for (const attempt of attempts) {
    // Order-INDEPENDENT key (same helper the "viewing" match uses): two runs
    // that built the identical maze can store their blocks in a different order,
    // and a raw JSON.stringify would split them into two rows that both flag
    // "viewing". mazeKey sorts the blocks first, so they merge into one ×N row.
    const key = mazeKey(attempt.maze);
    const group = byMaze.get(key);
    if (group) {
      group.count++;
      group.supreme = group.supreme || attempt.supreme;
      group.ranked = group.ranked || attempt.ranked;
      group.pinned = group.pinned || attempt.pinned;
      group.createds.push(attempt.created);
      if (attempt.created > group.latest) {
        group.latest = attempt.created;
        group.attempt = attempt;
      }
    } else {
      byMaze.set(key, {
        id: key,
        attempt,
        count: 1,
        latest: attempt.created,
        supreme: attempt.supreme,
        ranked: attempt.ranked,
        pinned: attempt.pinned,
        createds: [attempt.created],
      });
    }
  }

  // Best (longest) first identifies the BEST/SUPREME row regardless of the
  // chosen order; "recent" instead orders by each maze's latest run.
  const byDuration = [...byMaze.values()].sort((a, b) =>
    b.attempt.duration - a.attempt.duration
  );
  // The best time itself, so EVERY row that ties it is badged BEST — not just
  // the first one (these rows are distinct mazes that happen to share a time).
  // Derived off the always-descending byDuration, so the BEST badge is unaffected
  // by the chosen direction.
  const bestDuration = byDuration[0]?.attempt.duration;
  // Apply the chosen sort, then flip the whole order when reversed — Best goes
  // shortest-first, Recent oldest-first.
  const dir = reversed ? -1 : 1;
  const ordered = [...byMaze.values()].sort((a, b) =>
    sort === "recent"
      ? dir * (b.latest - a.latest)
      : dir * (b.attempt.duration - a.attempt.duration)
  );
  // Pinned runs float to the top as the primary sort, keeping the chosen
  // best/recent order within each partition (Array.sort is stable). Only when
  // the full field is shown — mid-daily (simplified) the panel is inert and
  // pinning is hidden, so nothing reorders under an in-progress run.
  const groups = simplified
    ? ordered
    : [...ordered].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  // Toggle a maze-group's pin: optimistically flip every member locally (so the
  // row jumps to/from the top at once), then persist. On failure, flip back.
  // The panel's `iteration` is always set once runs are shown; guard anyway.
  const togglePin = (createds: number[], next: boolean) => {
    if (iteration === undefined) return;
    const inGroup = new Set(createds);
    const flip = (value: boolean) =>
      setViewedAttempts((prev) =>
        prev.map((a) => inGroup.has(a.created) ? { ...a, pinned: value } : a)
      );
    flip(next);
    api.setRunPinned({ iteration, created: createds, pinned: next })
      .then((r) => {
        if (r && "error" in r) flip(!next);
      })
      .catch(() => flip(!next));
  };

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
                title={sort === mode ? "Tap to reverse order" : undefined}
                onClick={() => pickSort(mode)}
              >
                {mode === "recent" ? "Recent" : "Best"}
                {sort === mode && (
                  // The active tab spells out its direction in words rather than
                  // an arrow: Recent shows relative "Xh ago" times, so the ago
                  // count rises as recency falls — a bare ↓/↑ would be ambiguous.
                  // Tapping the active tab flips it. Defaults are newest/longest.
                  <span class="attempts__sort-dir">
                    {" · "}
                    {mode === "recent"
                      ? (reversed ? "oldest" : "newest")
                      : (reversed ? "shortest" : "longest")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {groups.length
        ? (
          <div class="attempts__list">
            {groups.map((group) => {
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
              const isBest = attempt.duration === bestDuration;
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
                    (isViewing ? " attempts__row--viewing" : "") +
                    (group.pinned ? " attempts__row--pinned" : "")}
                  key={group.id}
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
                  <span class="attempts__time mono">
                    {formatSeconds(attempt.duration, { min: 0 })}s
                  </span>
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
                          // p100 red. The two record states still sit above
                          // the ramp: a supreme p100 is gold, a record-tying
                          // one peak chartreuse.
                          <span
                            class="attempts__pct"
                            style={{
                              "--pct": supreme
                                ? "var(--gold)"
                                : peak
                                ? "var(--peak)"
                                : percentileBand(attempt.percentile),
                            }}
                          >
                            p{formatPercentile(attempt.percentile)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {isViewing && <span class="attempts__viewing">viewing</span>}
                  {clickable && (
                    <button
                      type="button"
                      class={"attempts__pin tapc" +
                        (group.pinned ? " attempts__pin--active" : "")}
                      aria-pressed={group.pinned}
                      title={group.pinned ? "Unpin run" : "Pin run to top"}
                      aria-label={group.pinned ? "Unpin run" : "Pin run to top"}
                      onClick={(e) => {
                        // Don't let the pin toggle also trigger the row's
                        // view-this-maze click.
                        e.stopPropagation();
                        togglePin(group.createds, !group.pinned);
                      }}
                    >
                      <PinIcon filled={group.pinned} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )
        : <div class="attempts__empty">No runs yet</div>}
    </div>
  );
};
