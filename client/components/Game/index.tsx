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
import { GameStateContext } from "./useGameState.ts";
import { Daily } from "./Daily.tsx";
import { TodayResult } from "./TodayResult.tsx";
import { Calendar } from "./Calendar.tsx";
import { Attempts } from "./Attempts.tsx";
import { AttemptsRemaining } from "./AttemptsRemaining.tsx";
import { Hud } from "./Hud.tsx";

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
  } = useContext(GameStateContext);
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
    />
  );
};

export const Game = (
  { extraAttemptBannerTime }: { extraAttemptBannerTime?: boolean },
) => {
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
          <AttemptsRemaining
            extraAttemptBannerTime={extraAttemptBannerTime ?? false}
          />
        </div>
        {
          /* One wrapper so mobile can scroll these as a unit below the board;
            on desktop it's `display: contents`, letting the three panels drop
            straight into the grid (today/cal left, attempts right). */
        }
        <div class="game__panel">
          <TodayResult />
          <Attempts />
          <Calendar />
        </div>
      </div>
      <Daily />
    </>
  );
};
