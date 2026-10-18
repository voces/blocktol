import { Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import {
  percentileColor,
  standingColor,
} from "../../../common/percentileColor.ts";
import {
  boardOf,
  effectiveSort,
  fetchStandings,
  openStandingsRequest,
  refreshStandings,
  standingsByKey,
  standingsSort,
  todayIteration,
} from "../../store/standings.ts";
import { dailyItems } from "../../store/dailyItems.ts";
import { syncViewUrl, viewReady } from "../../store/notifNav.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { formatSeconds } from "../../../common/format.ts";
import { Chevron, Crown } from "./icons.tsx";
import { formatRank } from "./helpers.ts";
import { StandingsSheet } from "./Sheet.tsx";
import { t } from "../../util/t.ts";

// The collapsed standings sliver: your rank and the leader on the day the board
// shows. A bottom dock on mobile, a peek card in the right rail on desktop (CSS
// only, see `.standings-dock`). Tapping opens the full sheet; a past day swaps
// in that day's frozen board.
//
// On TODAY the dock is hidden, but keeps its slot so nothing jumps, until the
// daily is done: the field would anchor how a player approaches their remaining
// attempts. It renders when the third attempt lands, UNDER the result card
// (z-index below `.result`), so closing the card uncovers fresh standings. Past
// days always show. The data is prefetched from boot.
export const StandingsDock = () => {
  const { iteration, dailyInProgress } = useContext(GameStateContext);
  // Until a board (or today's standings) has loaded, treat the view as today.
  const isToday = iteration === undefined ||
    iteration === todayIteration.value;
  // Hidden only mid-run on today's live ranked daily (see dailyInProgress).
  const revealed = !dailyInProgress;

  const [open, setOpen] = useState(false);
  // The active sort (persisted, shared with the sheet) picks the daily or PB
  // board; both ride one response, so switching never fetches. The effective
  // sort (below) falls back to PB when the day has no ranked daily runs.
  const persistedSort = standingsSort.value;
  // Fetch the viewed day (boot consumes the primed today fetch); re-fires as
  // the calendar swaps days or the today entry first resolves.
  useEffect(() => {
    fetchStandings(isToday ? undefined : iteration);
  }, [iteration, isToday]);
  // The reveal follows the player's own attempts, which move today's board:
  // re-rank behind the appearing dock.
  useEffect(() => {
    if (revealed && isToday) refreshStandings(undefined);
  }, [revealed]);

  const key = isToday ? todayIteration.value : iteration;

  // A notification asked to open the leaderboard for a day. Open once the board
  // shows that day (the click navigates in parallel), then clear the request.
  // The reveal gate holds: a live daily won't pop its field open.
  const request = openStandingsRequest.value;
  useEffect(() => {
    if (!request || !revealed) return;
    const wantsThisDay = request.iteration === undefined
      ? isToday
      : request.iteration === key;
    if (!wantsThisDay) return;
    setOpen(true);
    refreshStandings(isToday ? undefined : iteration);
    openStandingsRequest.value = null;
  }, [request, revealed, key, isToday]);

  const s = key === undefined ? undefined : standingsByKey.value.get(key);
  const sort = effectiveSort(s, persistedSort);

  // Reflect the viewed day + open sheet in the URL (see syncViewUrl): today is
  // "/", a past day "/YYYYMMDD", an open sheet adds "?board=<sort>". `?board`
  // carries the PERSISTED sort, not the effective one: restoring it re-runs
  // setStandingsSort, so writing the PB fallback of a ranked-less day would
  // flip the global preference.
  //
  // The day comes from the loaded calendar (dailyItems) so a click updates the
  // URL synchronously; the standings response is the fallback for a day not yet
  // paged in. Gated on viewReady so the boot mount doesn't clobber a deep
  // link's entry URL before consumeDeepLink restores it.
  const day = isToday
    ? undefined
    : (iteration !== undefined
      ? dailyItems.value.get(iteration)?.daily
      : undefined) ?? s?.day;
  const dayKey = day ? day.join("-") : "";
  useEffect(() => {
    if (!viewReady.value) return;
    if (!isToday && !day) return;
    syncViewUrl(day, open, persistedSort);
  }, [viewReady.value, isToday, dayKey, open, persistedSort]);

  const b = boardOf(s, sort);
  const leader = b?.rows[0];
  const me = b?.me ?? null;

  // Rank colour: record states first (gold outright #1, chartreuse shared),
  // then a ramp that differs per board:
  //   - daily: ranked percentile, linear via percentileColor;
  //   - PB: maze standing in [min, best], as in the runs panel, gamma-boosted
  //     via standingColor so a strong build reads green even at #2.
  const rankColor = !me
    ? undefined
    : me.record === "beat"
    ? "var(--gold)"
    : me.record === "match"
    ? "var(--peak)"
    : sort === "pb"
    ? (me.percent != null ? standingColor(me.percent) : undefined)
    : (me.percentile != null ? percentileColor(me.percentile) : undefined);

  return (
    <>
      <button
        type="button"
        class={"standings-dock tapc" +
          (revealed ? "" : " standings-dock--hidden")}
        aria-label={t("standings.open")}
        onClick={() => {
          setOpen(true);
          // The sheet is opening onto possibly-stale ranks; refresh behind it.
          refreshStandings(isToday ? undefined : iteration);
        }}
      >
        <span class="standings-dock__chevron">
          <Chevron />
        </span>
        <span class="standings-dock__text">
          <span class="standings-dock__title">
            {t("standings.title")}
            {me && (
              <>
                {" · "}
                <span
                  class="standings-dock__rank mono"
                  style={rankColor ? { color: rankColor } : undefined}
                >
                  #{formatRank(me.rank, me.tied)}
                </span>
              </>
            )}
          </span>
          <span class="standings-dock__sub">
            {!s ? " " : leader
              ? (
                <>
                  {leader.record === "beat" && <Crown />}
                  {sort === "pb"
                    ? (leader.you
                      ? t("standings.leadYouPb")
                      : t("standings.leadOtherPb", { name: leader.name }))
                    : (leader.you
                      ? t("standings.leadYou")
                      : t("standings.leadOther", { name: leader.name }))}
                  {" · "}
                  <span
                    class={"mono" +
                      (leader.record === "beat"
                        ? " standings-dock__lead--gold"
                        : leader.record === "match"
                        ? " standings-dock__lead--lime"
                        : "")}
                  >
                    {formatSeconds(leader.time)}s
                  </span>
                </>
              )
              : isToday
              ? t("standings.noRunsToday")
              : t("standings.noRunsDay")}
          </span>
        </span>
      </button>
      {open && revealed && (
        <StandingsSheet
          iteration={isToday ? undefined : iteration}
          isToday={isToday}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
