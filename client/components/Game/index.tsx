import { useContext, useRef } from "preact/compat";
import { Fragment, h } from "preact";
import { Board } from "../Board.tsx";
import { useInit } from "./useInit.ts";
import { useClock } from "./useClock.ts";
import { useInputStart } from "./useInputStart.ts";
import { useInputEnd } from "./useInputEnd.ts";
import { useOnSlow } from "./useOnSlow.ts";
import { GameStateContext } from "./useGameState.ts";
import { Daily } from "./Daily.tsx";
import { DailySelector } from "./DailySelector.tsx";
import { Log } from "./Log.tsx";
import { AttemptsRemaining } from "./AttemptsRemaining.tsx";
import { Hud } from "./Hud.tsx";

export const Game = (
  { extraAttemptBannerTime }: { extraAttemptBannerTime?: boolean },
) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const {
    time,
    blocks,
    checkpoint,
    grid,
    invalid,
    transitionBlock,
    power,
    placingBlockRef,
    touching,
    thunderHover,
    run,
    setRun,
    date,
  } = useContext(GameStateContext);

  useInit();
  useClock();
  useInputStart(svgRef.current);
  useInputEnd(svgRef.current);
  const onSlow = useOnSlow();

  return (
    <>
      <div class="game">
        <DailySelector />
        <div class="game__board">
          <Hud />
          <Board
            placingBlock={placingBlockRef.current}
            touching={touching}
            time={time}
            svgRef={svgRef}
            transitionBlock={transitionBlock}
            power={power}
            thunderHover={thunderHover}
            blocks={blocks}
            checkpoint={checkpoint}
            invalid={invalid}
            run={run}
            onFinish={() => setRun(undefined)}
            grid={grid}
            onSlow={onSlow}
            date={date}
          />
          <AttemptsRemaining
            extraAttemptBannerTime={extraAttemptBannerTime ?? false}
          />
        </div>
        <Log />
      </div>
      <Daily />
    </>
  );
};
