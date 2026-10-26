import { h } from "preact";
import { useContext } from "preact/compat";
import { formatCount, formatSeconds } from "../../../common/format.ts";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileBand,
  standingBand,
} from "../../../common/percentileColor.ts";
import { standing } from "../../../common/standing.ts";
import { api } from "../../api.ts";
import { showBoard } from "../../store/board.ts";
import { type DailyItem, dailyItems } from "../../store/dailyItems.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { t } from "../../util/t.ts";
import { GameStateContext } from "./useGameState.ts";

type Item = DailyItem;

const percentOf = (item: Item) =>
  typeof item.ownBest === "number" && typeof item.best === "number"
    ? standing(item.ownBest, item.min, item.best)
    : null;

// Today's standing: the ranked result (best of the three attempts, with its
// field percentile) and the personal best (possibly a higher free-play run).
export const TodayResult = () => {
  const items = dailyItems.value;
  const summary = useApiListener("getDailySummary");
  const { viewMaze, attemptsRemaining, iteration } = useContext(
    GameStateContext,
  );

  // Shown only once all three attempts are spent; mid-daily it would spoil the
  // standing.
  if (attemptsRemaining !== 0) return null;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${
    now.getMonth() + 1
  }-${now.getDate()}`;
  const today = [...items.values()].find((i) => i.daily.join("-") === todayKey);

  // These results are today's but the board may show another day. Stage
  // today's board first (so the maze lands on the right fixed pieces), then
  // overlay; skipped if a newer navigation superseded it.
  const onToday = today && iteration === today.iteration;
  const reviewToday = (show: () => void) => {
    if (onToday || !today) return show();
    void showBoard(today.iteration).then((staged) => {
      if (staged) show();
    });
  };

  // The best maze lives server-side: fetch it while staging the board, and
  // overlay once both land (skipped if superseded).
  const reviewBest = () => {
    if (!today) return;
    const best = api.best({ iteration: today.iteration });
    const staged = onToday ? Promise.resolve(true) : showBoard(today.iteration);
    void Promise.all([staged, best]).then(([ok, b]) => {
      if (ok && !("error" in b)) viewMaze(b.maze);
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

  // Each chip takes its percentile band, as in the result modal: supreme gold,
  // a tie for the field's top peak green-yellow.
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
      <div class="section-title">{t("today.title")}</div>
      <div class="today-result__chips">
        <div
          class={"today-result__chip band-card" +
            (rankedBest?.supreme ? " today-result__chip--glow" : "") +
            (rankedBest ? " today-result__chip--clickable tapc" : "")}
          style={{ "--chip": rankedBand }}
          title={rankedBest ? t("today.viewMaze") : undefined}
          onClick={rankedBest
            ? () => reviewToday(() => viewMaze(rankedBest.maze))
            : undefined}
        >
          <span class="today-result__head">{t("today.ranked")}</span>
          <div class="today-result__value mono">
            {rankedBest
              ? `${formatSeconds(rankedBest.duration, { min: 0 })}s`
              : "—"}
          </div>
          <div class="today-result__sub">
            {rankedBest
              ? `${t("today.bestOf", { count: formatCount(ranked.length) })}${
                typeof rankedBest.percentile === "number"
                  ? ` · p${formatPercentile(rankedBest.percentile)}`
                  : ""
              }`
              : t("today.notPlayed")}
          </div>
        </div>
        <div
          class={"today-result__chip band-card" +
            (today?.supreme ? " today-result__chip--glow" : "") +
            (today && personalBest != null
              ? " today-result__chip--clickable tapc"
              : "")}
          style={{ "--chip": personalBand }}
          title={today && personalBest != null
            ? t("today.viewMaze")
            : undefined}
          onClick={today && personalBest != null ? reviewBest : undefined}
        >
          <span class="today-result__head">{t("today.personalBest")}</span>
          <div class="today-result__value mono">
            {personalBest != null
              ? `${formatSeconds(personalBest, { min: 0 })}s`
              : "—"}
          </div>
          <div class="today-result__sub">
            {personalBest == null ? t("today.notPlayed") : [
              personalUnranked ? t("today.unranked") : "",
              personalPct == null ? "" : `${formatPercentile(personalPct)}%`,
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
};
