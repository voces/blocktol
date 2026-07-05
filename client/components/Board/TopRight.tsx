import { h } from "preact";
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
    <g
      className="control"
      onMouseDown={clickHandler}
      onTouchStart={clickHandler}
    >
      <text
        x={18.8}
        y={0.8}
        font-size={0.8}
        fill="var(--maze-text)"
        text-anchor="end"
        className={hasResources ? undefined : "flash-ready"}
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
        >
          Ready?
        </text>
      )}
      {
        /*
        Transparent hit target covering the top-right wall band. SVG <text>
        only hit-tests on its painted glyphs, so on touch devices a finger
        that lands between glyphs would otherwise hit the wall behind the
        text and be treated as a board interaction. This gives the control a
        solid, finger-sized tap area.
      */
      }
      <rect
        x={11}
        y={0}
        width={9}
        height={1}
        fill="transparent"
        pointer-events="all"
      />
    </g>
  );
};
