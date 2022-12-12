import { useContext, useEffect, useRef, useState } from "preact/compat";
import { Fragment, h } from "preact";
import { Board } from "../Board.tsx";
import { useInit } from "./useInit.ts";
import { useClock } from "./useClock.ts";
import { useInputStart } from "./useInputStart.ts";
import { useInputEnd } from "./useInputEnd.ts";
import { useOnSlow } from "./useOnSlow.ts";
import { GameStateContext } from "./useGameState.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { StartMessage } from "../../../common/serverToClientMessage.ts";
import { Daily } from "./Daily.tsx";

export const Game = (
  { extraAttemptBannerTime }: { extraAttemptBannerTime?: boolean },
) => {
  const connection = useContext(ConnectionContext);
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
    date,
  } = useContext(GameStateContext);
  const [attemptsRemaining, setAttemptsRemaining] = useState(-1);

  useInit();
  useClock();
  useInputStart(svgRef.current);
  useInputEnd(svgRef.current);
  const onSlow = useOnSlow();

  useEffect(() => {
    let timeout = -1;

    const startCallback = ({ attempts }: StartMessage) => {
      if (attempts <= 0) return;

      setAttemptsRemaining(attempts);
      timeout = setTimeout(
        () => setAttemptsRemaining(-1),
        (attempts + (extraAttemptBannerTime ? 2 : 0)) * 1_000,
      );
    };

    connection.addEventListener("start", startCallback);

    return () => {
      connection.removeEventListener("start", startCallback);
      clearTimeout(timeout);
    };
  }, [connection]);

  return (
    <>
      {/* <Log /> */}
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
        date={date}
      />
      {attemptsRemaining > 0 && (
        <div
          style={{
            width: "min(800px, 100vw, calc(100vh - 110px))",
            height: 0,
            paddingBottom: "min(800px, 100vw, 100vh - 110px)",
            margin: "calc(-1 * min(800px, 100vw, 100vh - 110px)) auto 0",
            position: "relative",
            color: "var(--maze-text)",
            lineHeight: "calc(min(800px, 100vw, calc(100vh - 110px)) / 3)",
            animation: `1s ease-out ${
              attemptsRemaining + (extraAttemptBannerTime ? 2 : 0) - 1
            }s attemptsLoad`,
            fontSize: "calc(min(400px, 100vw, 100vh - 110px) / 10)",
            filter: "drop-shadow(1px 1px 4px var(--color))",
          }}
        >
          {attemptsRemaining} attempts remaining
        </div>
      )}
      <Daily />
    </>
  );
};
