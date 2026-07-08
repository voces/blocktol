import { Fragment, h } from "preact";
import { useEffect, useState } from "preact/compat";
import { avatarColorFromHue, avatarInitial } from "../../../common/avatar.ts";
import { StandingsData } from "../../store/standings.ts";
import { Crown } from "./icons.tsx";
import {
  formatAgo,
  formatCountdown,
  formatDay,
  formatRank,
  formatTime,
} from "./helpers.ts";

type Row = StandingsData["rows"][number];

// One board row. A single accent per row — achievement wins over identity, so
// a record state (gold/lime) outranks the viewer's own green; the avatar keeps
// the player's identity colour regardless.
const BoardRow = ({ row }: { row: Row }) => {
  const state = row.record === "beat"
    ? "gold"
    : row.record === "match"
    ? "lime"
    : row.you
    ? "you"
    : null;
  return (
    <div
      class={"standings-row band-card" +
        (state ? ` standings-row--${state}` : "")}
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
        <span class="standings-row__sub">
          {row.you ? `you · ${formatAgo(row.at)}` : formatAgo(row.at)}
        </span>
      </span>
      <span class="standings-row__time mono">
        {formatTime(row.time)}
        <span class="standings-row__unit">s</span>
      </span>
    </div>
  );
};

// The expanded standings: a bottom sheet on mobile, a right-hand side sheet on
// desktop (purely CSS, see `.standings-modal`). The podium and the viewer's
// neighbourhood, with exact "N between" separators where the window skips.
// The dock passes the viewed day's data down, so both always show one day.
export const StandingsSheet = (
  { standings: s, onClose }: {
    standings: StandingsData | undefined;
    onClose: () => void;
  },
) => {
  // The countdown only needs minute resolution; re-render on a slow tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div class="standings-modal" onClick={onClose}>
      <div
        class="standings-sheet"
        role="dialog"
        aria-label="Standings"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="standings-sheet__handle tapc"
          aria-label="Close standings"
          onClick={onClose}
        />
        <div class="standings-sheet__head">
          <div>
            <div class="standings-sheet__title">Standings</div>
            <div class="standings-sheet__date">{s ? formatDay(s.day) : ""}</div>
          </div>
          <div class="standings-sheet__side">
            {s && (s.final
              ? <span class="standings-sheet__final">Final</span>
              : s.closesAt != null && (
                <span class="standings-sheet__timer">
                  <span class="mono">{formatCountdown(s.closesAt)}</span>
                  <span>until ranked</span>
                </span>
              ))}
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
        <div class="standings-sheet__meta">
          <span class="mono">{s?.players ?? 0}</span> players
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
              <BoardRow row={row} />
            </Fragment>
          ))}
          {s && s.rows.length === 0 && (
            <div class="standings-sheet__empty">No runs this day</div>
          )}
        </div>
      </div>
    </div>
  );
};
