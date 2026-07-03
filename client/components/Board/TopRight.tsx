import { Fragment, h } from "preact";
import { useCallback, useContext, useEffect } from "preact/compat";
import { api } from "../../api.ts";
import { useIteration } from "../../hooks/useIteration.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "../Game/useGameState.ts";

export const TopRight = (
  { time, hasResources }: { time: number; hasResources: boolean },
) => {
  const { run, power, setTime } = useContext(GameStateContext);

  const clickHandler = useCallback((e: MouseEvent | TouchEvent) => {
    if (hasResources) return;

    e.preventDefault();
    e.stopPropagation();

    setTime(0);
  }, [hasResources]);

  const iteration = useIteration();

  useEffect(() => {
    const keyDownCallback = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.metaKey || !run) return;
      if (power === -1) {
        iteration && api.startRun({ iteration, timeZone: getTimeZone() });
      } else setTime(0);
    };
    globalThis.addEventListener("keydown", keyDownCallback);

    return () => globalThis.removeEventListener("keydown", keyDownCallback);
  }, [run, power]);

  if (time <= 0) return null;

  return (
    <>
      <text
        x={18.8}
        y={0.8}
        font-size={0.8}
        fill="var(--maze-text)"
        text-anchor="end"
        className={hasResources ? undefined : "flash-ready"}
        onMouseDown={clickHandler}
        onTouchStart={clickHandler}
      >
        {time} seconds to build
      </text>
      {!hasResources && (
        <text
          x={17}
          y={0.8}
          font-size={0.8}
          fill="var(--maze-text)"
          text-anchor="end"
          className="flash-ready ready"
          onMouseDown={clickHandler}
          onTouchStart={clickHandler}
        >
          Ready?
        </text>
      )}
    </>
  );
};
