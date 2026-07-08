import { Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import {
  fetchStandings,
  refreshStandings,
  standings,
} from "../../store/standings.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { Chevron, Crown } from "./icons.tsx";
import { formatRank, formatTime } from "./helpers.ts";
import { StandingsSheet } from "./Sheet.tsx";

// The collapsed standings sliver: your rank and the current leader, always in
// reach — a pinned bottom dock on mobile, a peek card in the right rail on
// desktop (purely CSS, see `.standings-dock`).  Tapping opens the full sheet.
//
// Hidden — but still occupying its slot, so nothing below jumps — until the
// daily is done AND its result card has been closed: surfacing the field
// mid-daily would anchor how a player approaches their remaining attempts,
// and surfacing it under the result card would upstage their own reveal. The
// data itself is prefetched from boot so the reveal is instant.
export const StandingsDock = () => {
  const { attemptsRemaining, dailyResultClosed } = useContext(GameStateContext);
  const revealed = attemptsRemaining === 0 && dailyResultClosed;

  const [open, setOpen] = useState(false);
  // Consume the boot-primed fetch (or serve the fresh cache) on mount.
  useEffect(() => {
    fetchStandings();
  }, []);
  // The reveal follows the player's own attempts, which move the board:
  // re-rank behind the appearing dock.
  useEffect(() => {
    if (revealed) refreshStandings();
  }, [revealed]);

  const s = standings.value;
  const leader = s?.rows[0];
  const me = s?.me ?? null;

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
          refreshStandings();
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
                <span class="standings-dock__rank mono">
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
                        : "")}
                  >
                    {formatTime(leader.time)}s
                  </span>
                </>
              )
              : "no runs yet today"}
          </span>
        </span>
      </button>
      {open && revealed && <StandingsSheet onClose={() => setOpen(false)} />}
    </>
  );
};
