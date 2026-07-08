import { h } from "preact";
import { useContext } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileBand,
  standingBand,
} from "../../../common/percentileColor.ts";
import { api } from "../../api.ts";
import { showBoard } from "../../store/board.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { DailyItem, useDailyItems } from "../../hooks/useDailyItems.tsx";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "./useGameState.ts";

type Item = DailyItem;

const percentOf = (item: Item) =>
  typeof item.ownBest === "number" && typeof item.best === "number"
    ? item.best === item.min
      ? 1
      : (item.ownBest - item.min) / (item.best - item.min)
    : null;

// Today's standing at a glance: the ranked result (best of the three attempts,
// with its field percentile and rating) and the personal best (which may be a
// higher unranked free-play run).
export const TodayResult = () => {
  const { items } = useDailyItems();
  const summary = useApiListener("getDailySummary");
  const { viewMaze, attemptsRemaining, iteration } = useContext(
    GameStateContext,
  );

  // While the daily is still in progress (attempts left, or the summary hasn't
  // loaded yet) there's no result to show yet — and surfacing it mid-run would
  // spoil the standing. Only reveal it once all three attempts are spent.
  if (attemptsRemaining !== 0) return null;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${
    now.getMonth() + 1
  }-${now.getDate()}`;
  const today = [...items.values()].find((i) => i.daily.join("-") === todayKey);

  // These results are today's, but the board might be showing another day. Load
  // today's board first (so the maze renders on the right fixed pieces and the
  // calendar selects today) before overlaying the reviewed maze — skipped if a
  // newer navigation superseded this one mid-flight.
  const onToday = today && iteration === today.iteration;
  const reviewToday = (show: () => void) => {
    if (onToday || !today) return show();
    showBoard(today.iteration).then((staged) => {
      if (staged) show();
    });
  };

  const ranked = summary?.ranked ?? [];
  const rankedBest = ranked.length
    ? ranked.reduce((a, b) => (b.duration > a.duration ? b : a))
    : null;

  const personalBest = today?.ownBest ?? null;
  const personalPct = today ? percentOf(today) : null;
  // The personal best beats the ranked best only via a free-play run.
  const personalUnranked = today?.ownBest != null &&
    today.ownDailyBest != null && today.ownBest > today.ownDailyBest;

  // Tint each chip to its percentile band (supreme → gold + glow; a non-supreme
  // tie for the field's top → peak green-yellow), matching the result modal
  // rather than a fixed green/blue.
  const rankedBand = rankedBest
    ? rankedBest.supreme
      ? "var(--gold)"
      : rankedBest.percent === 1
      ? "var(--peak)"
      : percentileBand(
        typeof rankedBest.percentile === "number"
          ? rankedBest.percentile
          : null,
      )
    : "var(--text-mute)";
  const personalBand = personalBest == null
    ? "var(--text-mute)"
    : today?.supreme
    ? "var(--gold)"
    : personalPct === 1
    ? "var(--peak)"
    : standingBand(personalPct);

  return (
    <div class="today-result">
      <div class="section-title">Today</div>
      <div class="today-result__chips">
        <div
          class={"today-result__chip band-card" +
            (rankedBest?.supreme ? " today-result__chip--glow" : "") +
            (rankedBest ? " today-result__chip--clickable tapc" : "")}
          style={{ "--chip": rankedBand }}
          title={rankedBest ? "View this maze" : undefined}
          onClick={rankedBest
            ? () => reviewToday(() => viewMaze(rankedBest.maze))
            : undefined}
        >
          <span class="today-result__head">Ranked result</span>
          <div class="today-result__value mono">
            {rankedBest ? `${rankedBest.duration}s` : "—"}
          </div>
          <div class="today-result__sub">
            {rankedBest
              ? `best of ${ranked.length}${
                typeof rankedBest.percentile === "number"
                  ? ` · p${formatPercentile(rankedBest.percentile)}`
                  : ""
              }`
              : "not yet played"}
          </div>
        </div>
        <div
          class={"today-result__chip band-card" +
            (today?.supreme ? " today-result__chip--glow" : "") +
            (today && personalBest != null
              ? " today-result__chip--clickable tapc"
              : "")}
          style={{ "--chip": personalBand }}
          title={today && personalBest != null ? "View this maze" : undefined}
          onClick={today && personalBest != null
            ? () => reviewToday(() => api.best({ iteration: today.iteration }))
            : undefined}
        >
          <span class="today-result__head">Personal best</span>
          <div class="today-result__value mono">
            {personalBest != null ? `${personalBest}s` : "—"}
          </div>
          <div class="today-result__sub">
            {personalBest == null
              ? "not yet played"
              : `${
                personalPct == null ? "" : `${formatPercentile(personalPct)}%`
              }${personalUnranked ? " · unranked run" : ""}`}
          </div>
        </div>
      </div>
    </div>
  );
};
