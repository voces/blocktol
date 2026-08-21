import { useContext, useRef } from "preact/compat";
import { Fragment, h, RefObject } from "preact";
import { Board } from "../Board.tsx";
import {
  dragMoved,
  invalid,
  placingBlock,
  thunderHover,
  touching,
  transitionBlock,
} from "./interaction.ts";
import { useInit } from "./useInit.ts";
import { useClock } from "./useClock.ts";
import { useInputStart } from "./useInputStart.ts";
import { useInputEnd } from "./useInputEnd.ts";
import { useOnSlow } from "./useOnSlow.ts";
import {
  flagsArmed,
  flagsFor,
  saveFlags,
  splitsShowing,
} from "../../store/flags.ts";
import { GameStateContext } from "./useGameState.ts";
import { Daily } from "./Daily.tsx";
import { Prestart } from "./Prestart.tsx";
import { TodayResult } from "./TodayResult.tsx";
import { Calendar } from "./Calendar.tsx";
import { Attempts } from "./Attempts.tsx";
import { Hud } from "./Hud.tsx";
import { StandingsDock } from "../Standings/Dock.tsx";

// The board and everything pointer-driven, isolated so signal writes at
// mousemove speed re-render only this subtree — the HUD and panels above it
// don't see a thing. (IntroBoard keeps driving Board with plain props.)
const BoardArea = (
  { svgRef, onSlow }: {
    svgRef: RefObject<SVGSVGElement>;
    onSlow: ReturnType<typeof useOnSlow>;
  },
) => {
  const {
    time,
    blocks,
    checkpoint,
    grid,
    power,
    run,
    setRun,
    date,
    implosions,
    iteration,
  } = useContext(GameStateContext);
  // Flags come and go WITH the splits tape, because they are its marks: they
  // only mean something read off a row, so a board with no tape up has nothing
  // to show them for. That means a run you're reviewing or the one animating —
  // never a board you're building on, ranked or free play, where they'd be
  // clutter over the cells you're placing into. `splitsShowing` is the panel
  // itself saying the tape is up (Splits.tsx owns the condition; the board just
  // follows), so the two can't drift apart.
  const flagged = splitsShowing.value && iteration !== undefined;
  return (
    <Board
      placingBlock={placingBlock.value}
      touching={touching.value}
      time={time}
      svgRef={svgRef}
      transitionBlock={transitionBlock.value}
      power={power}
      thunderHover={thunderHover.value}
      blocks={blocks}
      checkpoint={checkpoint}
      invalid={invalid.value}
      run={run}
      onFinish={() => setRun(undefined)}
      grid={grid}
      onSlow={onSlow}
      date={date}
      dragMoved={dragMoved.value}
      implosions={implosions}
      flags={flagged ? flagsFor(iteration) : undefined}
      flagsArmed={flagsArmed.value}
      onFlagsChange={flagged
        ? (flags) => saveFlags(iteration, flags)
        : undefined}
    />
  );
};

export const Game = () => {
  const svgRef = useRef<SVGSVGElement>(null);

  useInit();
  useClock();
  useInputStart(svgRef.current);
  useInputEnd(svgRef.current);
  const onSlow = useOnSlow();

  return (
    <>
      <div class="game">
        <div class="game__board">
          <Hud />
          <BoardArea svgRef={svgRef} onSlow={onSlow} />
          <Prestart />
        </div>
        {
          /* One wrapper so mobile can scroll these as a unit below the board;
            on desktop it's `display: contents`, letting the three panels drop
            straight into the grid (today/cal left, attempts right). */
        }
        <div class="game__panel">
          <TodayResult />
          {
            /* The dock and the runs are one rail: on desktop they share a
              single grid area spanning both rows, so the runs start right
              under the dock instead of at the row line the (taller) left
              column sets — which left a wide dead gap above them. On mobile
              the rail is just a passthrough (the dock is pinned to the
              viewport there). */
          }
          <div class="game__rail">
            <StandingsDock />
            <Attempts />
          </div>
          <Calendar />
        </div>
      </div>
      <Daily />
    </>
  );
};
