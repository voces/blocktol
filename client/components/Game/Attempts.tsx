import { h } from "preact";
import { useContext, useState } from "preact/compat";
import { formatSeconds } from "../../../common/format.ts";
import { storage } from "../../util/storage.ts";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileBand,
  standingColor,
} from "../../../common/percentileColor.ts";
import { api, MessageMap } from "../../api.ts";
import type { MessageKey } from "../../../common/i18n.ts";
import { intlLocale, t } from "../../util/t.ts";
import { mazeKey } from "./helpers.ts";
import { GameStateContext } from "./useGameState.ts";

// Best-run badge → catalog key, mapped by a literal object so every live key
// stays greppable (see the i18n conventions).
const BADGE_KEY = {
  supreme: "badge.supreme",
  record: "badge.record",
  best: "badge.best",
} as const satisfies Record<"supreme" | "record" | "best", MessageKey>;

type Attempt = MessageMap["getDailySummary"]["attempts"][number];

// Per-row pin toggle: filled pushpin when pinned, outline when not.
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

// The runs sort persists across visits; unset or unrecognized means best.
// `reversed` flips the ACTIVE sort only (Best shortest-first, Recent
// oldest-first); switching tabs resets to that sort's default direction.
const SORT_KEY = "runsSort";
const DIR_KEY = "runsSortReversed";
const storedSort = (): Sort =>
  storage.getItem(SORT_KEY) === "recent" ? "recent" : "best";
const storedReversed = (): boolean => storage.getItem(DIR_KEY) === "1";

// When a run happened, on the viewer's clock: relative (Xs/Xm/Xh ago) if it's
// today or within 8 hours (an 11pm run still reads "3h ago" at 2am), else the
// date.
const formatWhen = (created: number) => {
  const diff = Date.now() - created;
  const when = new Date(created);
  const now = new Date();
  const today = when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() && when.getDate() === now.getDate();

  if (today || diff < 8 * 3_600_000) {
    const s = Math.max(0, Math.floor(diff / 1000));
    if (s < 60) return t("time.secondsAgo", { s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("time.minsAgo", { m });
    return t("time.hoursAgo", { h: Math.floor(m / 60) });
  }
  return when.toLocaleDateString(intlLocale(), { dateStyle: "medium" });
};

// Every run on the viewed board (`viewedAttempts`, ranked and free play), each
// tinted to its percentile band. Runs of the identical maze merge into one ×N
// row labelled by its latest run. The best row carries the BEST badge, or
// SUPREME when it tops the field. Clicking a row reviews that maze.
export const Attempts = () => {
  const {
    viewedAttempts,
    setViewedAttempts,
    viewMaze,
    dailyInProgress,
    blocks,
    viewing,
    phase,
    iteration,
  } = useContext(GameStateContext);
  // Display order only, remembered across visits: "best" (longest first) or
  // "recent" (by each maze's latest run). Re-tapping the active tab reverses.
  const [sort, setSort] = useState<Sort>(storedSort);
  const [reversed, setReversed] = useState<boolean>(storedReversed);
  const pickSort = (mode: Sort) => {
    // A different sort starts from its default direction.
    const nextReversed = mode === sort ? !reversed : false;
    storage.setItem(SORT_KEY, mode);
    storage.setItem(DIR_KEY, nextReversed ? "1" : "0");
    setSort(mode);
    setReversed(nextReversed);
  };
  const attempts = viewedAttempts ?? [];

  // Mid-daily the list is simplified: time, when, and which is your best, but
  // none of the field-relative info (percentile colour, %, SUPREME), which
  // would anchor how players approach their remaining attempts. It is full once
  // `dailyInProgress` is false.
  const simplified = dailyInProgress;
  if (simplified && attempts.length === 0) return null;

  // Merge runs of the identical maze, keeping the count and the latest run.
  const byMaze = new Map<
    string,
    {
      // The maze key; the render key, so a row keeps its DOM node when the
      // list re-sorts (a pin toggle floats it to the top).
      id: string;
      attempt: Attempt;
      count: number;
      latest: number;
      supreme: boolean;
      ranked: boolean;
      // Pinned if ANY member is pinned; `createds` holds every member's run
      // time so a toggle flips them together.
      pinned: boolean;
      createds: number[];
    }
  >();
  for (const attempt of attempts) {
    // Order-independent (also the "viewing" match): identical mazes can store
    // their blocks in different orders, which a raw JSON.stringify would split
    // into two rows.
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

  // Longest first, whatever the chosen order, to find the BEST row.
  const byDuration = [...byMaze.values()].sort((a, b) =>
    b.attempt.duration - a.attempt.duration
  );
  // Compared by time so every row tying the best is badged BEST. Taken from
  // `byDuration`, so the chosen direction doesn't move it.
  const bestDuration = byDuration[0]?.attempt.duration;
  // The chosen sort; `dir` flips it when reversed.
  const dir = reversed ? -1 : 1;
  const ordered = [...byMaze.values()].sort((a, b) =>
    sort === "recent"
      ? dir * (b.latest - a.latest)
      : dir * (b.attempt.duration - a.attempt.duration)
  );
  // Pinned rows float to the top, keeping the chosen order within each half
  // (Array.sort is stable). Not when simplified: the panel is inert then.
  const groups = simplified
    ? ordered
    : [...ordered].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  // Flips every member locally at once, then persists; flips back on failure.
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

  // The maze on the board: a review (`viewMaze`) or, in free play, the run
  // animating, so its row is marked from execution. Never mid-daily.
  const viewingKey = viewing || (!dailyInProgress && phase === "running")
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
        <div class="section-title">
          {
            /* Counts runs, not merged rows. */
          }
          {attempts.length
            ? t("attempts.titleCount", { count: attempts.length })
            : t("attempts.title")}
        </div>
        {groups.length > 1 && (
          <div
            class="attempts__sort"
            role="group"
            aria-label={t("attempts.sortRuns")}
          >
            {(["recent", "best"] as const).map((mode) => {
              const active = sort === mode;
              // The label names its direction, so no arrow is needed. An
              // inactive tab shows its default; reversal rides the active sort.
              const rev = active && reversed;
              const label = mode === "recent"
                ? (rev ? t("attempts.sortOldest") : t("attempts.sortNewest"))
                : (rev
                  ? t("attempts.sortShortest")
                  : t("attempts.sortLongest"));
              return (
                <button
                  key={mode}
                  type="button"
                  class={"attempts__sort-btn tapc" +
                    (active ? " attempts__sort-btn--active" : "")}
                  aria-pressed={active}
                  title={active ? t("attempts.reverseHint") : undefined}
                  onClick={() => pickSort(mode)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {groups.length
        ? (
          <div class="attempts__list">
            {groups.map((group) => {
              const { attempt } = group;
              // Full: the ramp colour, except supreme gold (took the record)
              // and peak green-yellow (tied the field's top without taking it).
              // Simplified: neutral, so the band doesn't signal standing.
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
              // Inert mid-daily: reviewing would replace the live attempt's
              // board, and the affordance alone would invite it.
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
                  title={clickable ? t("today.viewMaze") : undefined}
                  onClick={clickable
                    ? () => {
                      viewMaze(attempt.maze);
                      // On mobile the board is scrolled out of view; snap back.
                      document.querySelector(".game")?.scrollTo({ top: 0 });
                    }
                    : undefined}
                >
                  {
                    /* Always two decimals, so the mono column stays aligned. */
                  }
                  <span class="attempts__time mono">
                    {formatSeconds(attempt.duration)}s
                  </span>
                  <div class="attempts__meta">
                    <div class="attempts__kind">
                      {formatWhen(group.latest)}
                      {group.count > 1 && (
                        <span class="attempts__count">×{group.count}</span>
                      )}
                      {!simplified && group.ranked && (
                        <span class="attempts__daily">
                          {t("attempts.dailyTag")}
                        </span>
                      )}
                      {isBest && (!simplified || groups.length > 1) && (
                        <span class="attempts__badge">
                          {t(
                            BADGE_KEY[
                              supreme ? "supreme" : peak ? "record" : "best"
                            ],
                          )}
                        </span>
                      )}
                    </div>
                    {!simplified && (
                      <div class="attempts__sub">
                        <span>{formatPercentile(attempt.percent)}%</span>
                        {group.ranked && attempt.percentile != null && (
                          // Coloured by the percentile itself, not the row's
                          // band (a different metric: it could paint a p100
                          // red). Record states still override the ramp.
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
                  {isViewing && (
                    <span class="attempts__viewing">
                      {t("attempts.viewing")}
                    </span>
                  )}
                  {clickable && (
                    <button
                      type="button"
                      class={"attempts__pin tapc" +
                        (group.pinned ? " attempts__pin--active" : "")}
                      aria-pressed={group.pinned}
                      title={group.pinned
                        ? t("attempts.unpin")
                        : t("attempts.pinToTop")}
                      aria-label={group.pinned
                        ? t("attempts.unpin")
                        : t("attempts.pinToTop")}
                      onClick={(e) => {
                        // Keep the row's view-maze click from firing too.
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
        : <div class="attempts__empty">{t("attempts.empty")}</div>}
    </div>
  );
};
