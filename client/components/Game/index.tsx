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
import { DailySelector } from "./DailySelector.tsx";
import { Log } from "./Log.tsx";

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

    const startCallback = ({ todaysRemainingDailyAttempts }: StartMessage) => {
      if (todaysRemainingDailyAttempts <= 0) return;

      setAttemptsRemaining(todaysRemainingDailyAttempts);
      timeout = setTimeout(
        () => setAttemptsRemaining(-1),
        (todaysRemainingDailyAttempts + (extraAttemptBannerTime ? 2 : 0)) *
          1_000,
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
      <DailySelector />
      <Log />
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
        date={date}
      />
      {attemptsRemaining > 0 && (
        <div
          style={{
            width: "var(--maze-size)",
            height: 0,
            paddingBottom: "var(--maze-size)",
            margin: "calc(-1 * var(--maze-size)) auto 0",
            position: "relative",
            color: "var(--maze-text)",
            lineHeight: "calc(var(--maze-size) / 3)",
            animation: `1s ease-out ${
              attemptsRemaining + (extraAttemptBannerTime ? 2 : 0) - 1
            }s attemptsLoad`,
            fontSize: "calc(min(400px, 100vw, 100vh - 110px) / 10)",
            filter: "drop-shadow(1px 1px 4px var(--color))",
            pointerEvents: "none",
          }}
        >
          {attemptsRemaining} attempts remaining
        </div>
      )}
      <Daily />
    </>
  );
};
