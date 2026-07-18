import { Fragment, h } from "preact";
import { useEffect, useState } from "preact/compat";
import { avatarColorFromHue, avatarInitial } from "../../../common/avatar.ts";
import { useDragToClose } from "../../hooks/useDragToClose.ts";
import {
  boardOf,
  effectiveSort,
  fetchStandings,
  setStandingsSort,
  standingsByKey,
  StandingsData,
  StandingsSort,
  standingsSort,
  todayIteration,
} from "../../store/standings.ts";
import { Crown } from "./icons.tsx";
import { formatCount, formatSeconds } from "../../../common/format.ts";
import {
  formatAgo,
  formatCountdown,
  formatDay,
  formatRank,
} from "./helpers.ts";
import { t } from "../../util/t.ts";

type Row = NonNullable<ReturnType<typeof boardOf>>["rows"][number];

// One board row. A single accent per row: your identity colour on your own
// row, overridden by a record state's hue (gold/lime) when you hold one —
// achievement picks the COLOUR, but the "you" treatments (accented
// sub/rank/time, stronger wash) persist either way, so your row is findable
// at #1 too. The accent rides the --you custom property; the stylesheet's
// green is only the fallback. The avatar keeps the player's identity colour
// regardless.
//
// The big number is the sort's ranked value; the small line is the other
// board's value — "PB {pb}" on the daily board, "day {time}" on the PB board.
// Both boards carry a per-row timestamp (when the daily best / the best build
// was set), shown as the "2h ago" sub-line.
const BoardRow = ({ row, sort }: { row: Row; sort: StandingsSort }) => {
  const state = row.record === "beat"
    ? "gold"
    : row.record === "match"
    ? "lime"
    : null;
  const accent = state === "gold"
    ? "var(--gold)"
    : state === "lime"
    ? "var(--peak)"
    : avatarColorFromHue(row.hue);
  const sub = row.you
    ? t("standings.youSub", { ago: formatAgo(row.at) })
    : formatAgo(row.at);
  const smallLabel = sort === "daily"
    ? t("standings.rowPb")
    : t("standings.rowDay");
  return (
    <div
      class={"standings-row band-card" +
        (state ? ` standings-row--${state}` : "") +
        (row.you ? " standings-row--you" : "")}
      style={row.you ? { "--you": accent } : undefined}
    >
      <span class="standings-row__rank mono">
        {row.record === "beat" && <Crown />}
        {formatRank(row.rank, row.tied)}
      </span>
      <span
        class="standings-row__avatar"
        style={{ background: avatarColorFromHue(row.hue) }}
      >
        {avatarInitial(row.name)}
      </span>
      <span class="standings-row__who">
        <span class="standings-row__name">{row.name}</span>
        {sub && <span class="standings-row__sub">{sub}</span>}
      </span>
      <span class="standings-row__nums">
        <span class="standings-row__time mono">
          {formatSeconds(row.time)}
          <span class="standings-row__unit">s</span>
        </span>
        <span class="standings-row__small mono">
          {smallLabel}{" "}
          {row.secondary != null ? `${formatSeconds(row.secondary)}s` : "—"}
        </span>
      </span>
    </div>
  );
};

// The expanded standings: a bottom sheet on mobile, a right-hand side sheet on
// desktop (purely CSS, see `.standings-modal`). The podium and the viewer's
// neighbourhood, with exact "N between" separators where the window skips.
// Follows the board's viewed day; toggles between the daily and PB sorts — both
// arrive in one response, so the toggle is instant.
export const StandingsSheet = (
  { iteration, isToday, onClose }: {
    iteration?: number;
    isToday: boolean;
    onClose: () => void;
  },
) => {
  // The sort is shared with the dock and persisted across visits. Both boards
  // ride the same response, so switching it never fetches. The effective sort
  // (resolved once the board is in hand, below) falls back to PB when the day
  // has no ranked daily runs.
  const persistedSort = standingsSort.value;

  useEffect(() => {
    fetchStandings(isToday ? undefined : iteration);
  }, [iteration, isToday]);

  // The countdown only needs minute resolution; re-render on a slow tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Mobile: dragging the notch/header down slides the sheet with the finger
  // and closes past the threshold.
  const { offset, handlers } = useDragToClose(onClose);

  const keyIt = isToday ? todayIteration.value : iteration;
  const live = keyIt === undefined
    ? undefined
    : standingsByKey.value.get(keyIt);

  // Keep the last response on screen while a first load is in flight, so the
  // sheet never collapses to an empty shell.
  const [shown, setShown] = useState<StandingsData | undefined>();
  useEffect(() => {
    if (live) setShown(live);
  }, [live]);
  const s = live ?? shown;
  const sort = effectiveSort(s, persistedSort);
  const b = boardOf(s, sort);

  // A bare text button per the design — the active sort is accent-underlined
  // with a ▾ caret, the other muted.
  const SortTab = (
    { value, label }: { value: StandingsSort; label: string },
  ) => (
    <button
      type="button"
      class={"standings-sortby__tab tapc" +
        (sort === value ? " standings-sortby__tab--active" : "")}
      aria-pressed={sort === value}
      onClick={() => setStandingsSort(value)}
    >
      {label}
      {sort === value ? " ▾" : ""}
    </button>
  );

  return (
    <div class="standings-modal" onClick={onClose}>
      <div
        class="standings-sheet"
        role="dialog"
        aria-label={t("standings.title")}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="standings-sheet__handle tapc"
          aria-label={t("standings.closeHandle")}
          onClick={onClose}
          {...handlers}
        />
        <div class="standings-sheet__head" {...handlers}>
          <div>
            <div class="standings-sheet__title">{t("standings.title")}</div>
            <div class="standings-sheet__date">
              {s && b
                ? t("standings.dateLine", {
                  day: formatDay(s.day),
                  count: formatCount(b.players),
                })
                : ""}
            </div>
          </div>
          <div class="standings-sheet__side">
            {/* Daily board only; the PB board counts free play and never locks. */}
            {sort === "daily" && s?.closesAt != null && (
              <span class="standings-sheet__timer">
                <span class="mono">{formatCountdown(s.closesAt)}</span>
                <span>{t("standings.untilRanked")}</span>
              </span>
            )}
            <button
              type="button"
              class="modal__icon standings-sheet__close"
              aria-label={t("a11y.close")}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <div
          class="standings-sortby"
          role="group"
          aria-label={t("standings.sortGroup")}
        >
          <span class="standings-sortby__label mono">
            {t("standings.sortByLabel")}
          </span>
          <SortTab value="daily" label={t("standings.sortDaily")} />
          <SortTab value="pb" label={t("standings.sortPb")} />
        </div>
        <div class="standings-sheet__list">
          {(b?.rows ?? []).map((row) => (
            <Fragment key={row.rank + row.name}>
              {row.gapBefore > 0 && (
                <div class="standings-gap">
                  <span />
                  <span class="mono">
                    {t("standings.between", {
                      count: formatCount(row.gapBefore),
                    })}
                  </span>
                  <span />
                </div>
              )}
              <BoardRow row={row} sort={sort} />
            </Fragment>
          ))}
          {b && b.rows.length === 0 && (
            <div class="standings-sheet__empty">
              {sort === "daily"
                ? t("standings.emptyDaily")
                : t("standings.emptyPb")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
