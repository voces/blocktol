import { Fragment, h } from "preact";
import { useCallback, useContext } from "preact/compat";
import { ConnectionContext } from "../../contexts/Connection.ts";

export const TopRight = (
  { time, hasResources }: { time: number; hasResources: boolean },
) => {
  const connection = useContext(ConnectionContext);

  const clickHandler = useCallback((e: MouseEvent) => {
    if (hasResources) return;

    e.preventDefault();
    e.stopPropagation();

    connection.send({ kind: "ready" });
  }, [hasResources]);

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
        onClick={clickHandler}
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
          onClick={clickHandler}
        >
          Ready?
        </text>
      )}
    </>
  );
};
