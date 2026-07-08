import { Fragment, h } from "preact";
import { useEffect, useState } from "preact/compat";
import { avatarColorFromHue, avatarInitial } from "../../../common/avatar.ts";
import { useDragToClose } from "../../hooks/useDragToClose.ts";
import {
  fetchStandings,
  refreshStandings,
  setStandingsSort,
  standingsByKey,
  standingsKey,
  StandingsSort,
  standingsSort,
  todayIteration,
} from "../../store/standings.ts";
import { Crown } from "./icons.tsx";
import {
  formatAgo,
  formatCountdown,
  formatDay,
  formatRank,
  formatTime,
} from "./helpers.ts";

type Row = NonNullable<
  ReturnType<typeof standingsByKey.value.get>
>["rows"][number];

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
  // The PB board has no per-row timestamp; the daily board shows when the best
  // was set. The viewer is always tagged "you".
  const sub = sort === "daily"
    ? (row.you ? `you · ${formatAgo(row.at)}` : formatAgo(row.at))
    : (row.you ? "you" : "");
  const smallLabel = sort === "daily" ? "PB" : "day";
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
          {formatTime(row.time)}
          <span class="standings-row__unit">s</span>
        </span>
        <span class="standings-row__small mono">
          {smallLabel}{" "}
          {row.secondary != null ? `${formatTime(row.secondary)}s` : "—"}
        </span>
      </span>
    </div>
  );
};

// The expanded standings: a bottom sheet on mobile, a right-hand side sheet on
// desktop (purely CSS, see `.standings-modal`). The podium and the viewer's
// neighbourhood, with exact "N between" separators where the window skips.
// Follows the board's viewed day; toggles between the daily and all-time-PB
// sorts (each fetched/cached on demand).
export const StandingsSheet = (
  { iteration, isToday, onClose }: {
    iteration?: number;
    isToday: boolean;
    onClose: () => void;
  },
) => {
  // The sort is shared with the dock and persisted across visits.
  const sort = standingsSort.value;

  // Fetch the viewed (day, sort); refetch as the sort or day changes. Today
  // resolves server-side from the timezone.
  useEffect(() => {
    fetchStandings(isToday ? undefined : iteration, sort);
  }, [iteration, isToday, sort]);

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
  const s = keyIt === undefined
    ? undefined
    : standingsByKey.value.get(standingsKey(keyIt, sort));

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
      onClick={() => {
        setStandingsSort(value);
        // Opening onto possibly-stale ranks — refresh behind the switch.
        refreshStandings(isToday ? undefined : iteration, value);
      }}
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
        aria-label="Standings"
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="standings-sheet__handle tapc"
          aria-label="Close standings"
          onClick={onClose}
          {...handlers}
        />
        <div class="standings-sheet__head" {...handlers}>
          <div>
            <div class="standings-sheet__title">Standings</div>
            <div class="standings-sheet__date">
              {s ? `${formatDay(s.day)} · ${s.players} players` : ""}
            </div>
          </div>
          <div class="standings-sheet__side">
            {/* Daily board only; the PB board is all-time and never locks. */}
            {s?.closesAt != null && (
              <span class="standings-sheet__timer">
                <span class="mono">{formatCountdown(s.closesAt)}</span>
                <span>until ranked</span>
              </span>
            )}
            <button
              type="button"
              class="modal__icon standings-sheet__close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <div class="standings-sortby" role="group" aria-label="Sort standings">
          <span class="standings-sortby__label mono">SORT BY</span>
          <SortTab value="daily" label="DAILY" />
          <SortTab value="pb" label="PB" />
        </div>
        <div class="standings-sheet__list">
          {(s?.rows ?? []).map((row) => (
            <Fragment key={row.rank + row.name}>
              {row.gapBefore > 0 && (
                <div class="standings-gap">
                  <span />
                  <span class="mono">{row.gapBefore} between</span>
                  <span />
                </div>
              )}
              <BoardRow row={row} sort={sort} />
            </Fragment>
          ))}
          {s && s.rows.length === 0 && (
            <div class="standings-sheet__empty">
              {sort === "daily" ? "No runs this day" : "No runs yet"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
