import { ComponentChildren, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { ConnectionContext } from "../contexts/Connection.ts";
import { useConnectionState } from "../hooks/useConnectionState.ts";
import { getId } from "../util/id.ts";
import { Game } from "./Game/index.tsx";
import { GameStateContext, useGameState } from "./Game/useGameState.ts";
import { IntroBoard } from "./IntroBoard.tsx";

const Shell = ({ children }: { children: ComponentChildren }) => (
  <div style={{ textAlign: "center" }}>
    <h1>Blocktol</h1>
    {children}
  </div>
);

const getHasCompletedOnboarding = () =>
  localStorage.getItem("hasCompletedOnboarding") === "true";
const setHasCompletedOnboarding = () =>
  localStorage.setItem("hasCompletedOnboarding", "true");

export const App = () => {
  const id = getId();
  const connection = useContext(ConnectionContext);
  const connected = useConnectionState();
  const logInTimeout = useRef<number>();
  const hadCompletedOnboarding = useRef(getHasCompletedOnboarding());
  const [showOnboarding, setShowOnboarding] = useState(
    !hadCompletedOnboarding.current,
  );

  useEffect(() => {
    if (!connected || showOnboarding) return;

    clearTimeout(logInTimeout.current);
    connection.send({
      kind: "login",
      username: undefined,
      id,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [connected, showOnboarding]);

  const gameState = useGameState();

  if (showOnboarding) {
    return (
      <Shell>
        <IntroBoard
          onDone={() => {
            setShowOnboarding(false);
            setHasCompletedOnboarding();
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <GameStateContext.Provider value={gameState}>
        <Game extraAttemptBannerTime={!hadCompletedOnboarding.current} />
      </GameStateContext.Provider>
    </Shell>
  );
};
