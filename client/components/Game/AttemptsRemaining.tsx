import { useContext, useEffect, useState } from "preact/compat";
import { Fragment, h } from "preact";
import { GameStateContext } from "./useGameState.ts";

export const AttemptsRemaining = (
  { extraAttemptBannerTime }: { extraAttemptBannerTime: boolean },
) => {
  const { attemptsRemaining } = useContext(GameStateContext);
  const [lastAttemptsRemaining, setLastAttemptsRemaining] = useState(
    attemptsRemaining,
  );
  const [showMessage, setShowMessage] = useState(false);

  useEffect(() => {
    if (attemptsRemaining === lastAttemptsRemaining) return;
    setShowMessage(true);
    const timeout = setTimeout(
      () => setShowMessage(false),
      (attemptsRemaining + (extraAttemptBannerTime ? 2 : 0)) * 1_000,
    );
    return () => clearTimeout(timeout);
  }, [attemptsRemaining]);

  if (!showMessage) return null;

  return (
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
        fontSize: "min(calc(var(--maze-size) / 11), 64px)",
        filter: "drop-shadow(1px 1px 4px var(--color))",
        pointerEvents: "none",
      }}
    >
      {attemptsRemaining} attempts remaining
    </div>
  );
};
