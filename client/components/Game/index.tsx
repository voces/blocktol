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
// mousemove speed re-render only this subtree.
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
  // Flags show only with the splits tape (a review or the animating run), never
  // on a board being built, where they'd clutter the cells. `splitsShowing` is
  // Splits.tsx saying the tape is up, so the two can't drift.
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
          /* One wrapper so mobile scrolls the panels as a unit below the board;
            on desktop it's `display: contents`, so they join the grid. */
        }
        <div class="game__panel">
          <TodayResult />
          {
            /* The dock and the runs are one rail: on desktop a single grid
              area spanning both rows, so the runs sit right under the dock
              instead of at the taller left column's row line. On mobile it's
              a passthrough (the dock is viewport-pinned). */
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
