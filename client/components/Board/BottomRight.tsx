import { h } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/compat";
import {
  RunMessage,
  StartMessage,
} from "../../../common/serverToClientMessage.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { GameStateContext } from "../Game/useGameState.ts";

export const BottomRight = () => {
  const connection = useContext(ConnectionContext);
  const { rating } = useContext(GameStateContext);
  const [showRating, setShowRating] = useState(true);
  const [ownBest, setOwnBest] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [currentIteration, setCurrentIteration] = useState(-1);

  if (Number.isNaN(rating)) return null;

  useEffect(() => {
    const startCallback = (e: StartMessage) => {
      if (e.todaysRemainingDailyAttempts === 0) setShowRating(false);
      setOwnBest(e.ownBest);
      if (e.iteration !== currentIteration) {
        setLast(null);
        setCurrentIteration(e.iteration);
      }
    };

    const runCallback = (e: RunMessage) => {
      setLast(e.duration);
      if (!ownBest || e.duration > ownBest) setOwnBest(e.duration);
    };

    connection.addEventListener("start", startCallback);
    connection.addEventListener("run", runCallback);

    return () => {
      connection.removeEventListener("start", startCallback);
      connection.removeEventListener("run", runCallback);
    };
  }, [currentIteration, ownBest]);

  const clickHandler = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    connection.send({ kind: "best", iteration: currentIteration });
  }, [currentIteration]);

  return (
    <text
      x={18.8}
      y={19.75}
      font-size={0.8}
      fill="var(--maze-text)"
      text-anchor="end"
      onMouseDown={clickHandler}
    >
      {showRating
        ? Math.round(rating)
        : ownBest
        ? `${last ? `${last}s / ` : ""}${ownBest}s`
        : null}
    </text>
  );
};
