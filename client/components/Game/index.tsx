import { useContext, useRef } from "preact/hooks";
import { h } from "preact";
import { Board } from "../Board.tsx";
import { useInit } from "./useInit.ts";
import { useClock } from "./useClock.ts";
import { useInputStart } from "./useInputStart.ts";
import { useInputEnd } from "./useInputEnd.ts";
import { useOnSlow } from "./useOnSlow.ts";
import { GameStateContext } from "./useGameState.ts";

export const Game = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const {
    time,
    blocks,
    thunders,
    bricks,
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
    disconnected,
    rating,
    lastRating,
  } = useContext(GameStateContext);

  useInit();
  useClock();
  useInputStart(svgRef.current);
  useInputEnd(svgRef.current);
  const onSlow = useOnSlow();

  console.log({ blocks });

  return (
    <Board
      placingBlock={placingBlockRef.current}
      touching={touching}
      time={time}
      svgRef={svgRef}
      transitionBlock={transitionBlock}
      power={power}
      thunders={thunders}
      thunderHover={thunderHover}
      bricks={bricks}
      blocks={blocks}
      checkpoint={checkpoint}
      invalid={invalid}
      run={run}
      onFinish={() => setRun(undefined)}
      grid={grid}
      disconnected={disconnected}
      onSlow={onSlow}
      rating={rating}
      lastRating={lastRating}
    />
  );
};
