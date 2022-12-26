import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import {
  RunMessage,
  StartMessage,
} from "../../../common/serverToClientMessage.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { GameStateContext } from "../Game/useGameState.ts";

export const Rating = () => {
  const connection = useContext(ConnectionContext);
  const { rating } = useContext(GameStateContext);
  const [showRating, setShowRating] = useState(true);
  const [ownBest, setOwnBest] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);

  if (Number.isNaN(rating)) return null;

  useEffect(() => {
    const startCallback = (e: StartMessage) => {
      if (e.attempts === 0) setShowRating(false);
      setOwnBest(e.ownBest);
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
  }, []);

  return (
    <text
      x={18.8}
      y={19.75}
      font-size={0.8}
      fill="var(--maze-text)"
      text-anchor="end"
    >
      {showRating
        ? Math.round(rating)
        : ownBest
        ? `${last ? `${last}s / ` : ""}${ownBest}s`
        : null}
    </text>
  );
};
