import { Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { percentileColor } from "../../../common/percentileColor.ts";
import {
  fetchStandings,
  refreshStandings,
  standingsByIteration,
  todayIteration,
} from "../../store/standings.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { Chevron, Crown } from "./icons.tsx";
import { formatRank, formatTime } from "./helpers.ts";
import { StandingsSheet } from "./Sheet.tsx";

// The collapsed standings sliver: your rank and the current leader on
// whichever day the board is showing — a pinned bottom dock on mobile, a peek
// card in the right rail on desktop (purely CSS, see `.standings-dock`).
// Tapping opens the full sheet. Navigating the calendar to a past day swaps
// the whole feature to that day's (frozen) board.
//
// On TODAY the dock is hidden — but still occupying its slot, so nothing
// below jumps — until the daily is done AND its result card has been closed:
// surfacing the field mid-daily would anchor how a player approaches their
// remaining attempts, and surfacing it under the result card would upstage
// their own reveal. Past days are final, so they show unconditionally. The
// data itself is prefetched from boot so the reveal is instant.
export const StandingsDock = () => {
  const { iteration, attemptsRemaining, dailyResultClosed } = useContext(
    GameStateContext,
  );
  // Until a board (or today's standings) has loaded, treat the view as today.
  const isToday = iteration === undefined ||
    iteration === todayIteration.value;
  const revealed = isToday
    ? attemptsRemaining === 0 && dailyResultClosed
    : true;

  const [open, setOpen] = useState(false);
  // Fetch the viewed day (boot consumes the primed today fetch); re-fires as
  // the calendar swaps days or the today entry first resolves.
  useEffect(() => {
    fetchStandings(isToday ? undefined : iteration);
  }, [iteration, isToday]);
  // The reveal follows the player's own attempts, which move today's board:
  // re-rank behind the appearing dock.
  useEffect(() => {
    if (revealed && isToday) refreshStandings();
  }, [revealed]);

  const key = isToday ? todayIteration.value : iteration;
  const s = key === undefined ? undefined : standingsByIteration.value.get(key);
  const leader = s?.rows[0];
  const me = s?.me ?? null;

  // Your rank wears your standing: record states first (gold for an outright
  // #1, chartreuse for a shared record), then the continuous percentile ramp —
  // ranked percentiles are uniform by construction, so they colour linearly
  // (no STANDING_GAMMA; see percentileColor).
  const rankColor = !me
    ? undefined
    : me.record === "beat"
    ? "var(--gold)"
    : me.record === "match"
    ? "var(--peak)"
    : me.percentile != null
    ? percentileColor(me.percentile)
    : undefined;

  return (
    <>
      <button
        type="button"
        class={"standings-dock tapc" +
          (revealed ? "" : " standings-dock--hidden")}
        aria-label="Open standings"
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
            Standings
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
                  {leader.you ? "you lead" : `${leader.name} leads`}
                  {" · "}
                  <span
                    class={"mono" +
                      (leader.record === "beat"
                        ? " standings-dock__lead--gold"
                        : leader.record === "match"
                        ? " standings-dock__lead--lime"
                        : "")}
                  >
                    {formatTime(leader.time)}s
                  </span>
                </>
              )
              : isToday
              ? "no runs yet today"
              : "no runs that day"}
          </span>
        </span>
      </button>
      {open && revealed && (
        <StandingsSheet
          standings={s}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
