import { ComponentChildren, Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { ConnectionContext } from "../contexts/Connection.ts";
import { useConnectionState } from "../hooks/useConnectionState.ts";
import { getId } from "../util/id.ts";
import { Game } from "./Game/index.tsx";
import { GameStateContext, useGameState } from "./Game/useGameState.ts";
import { IntroBoard } from "./IntroBoard.tsx";
import { Login } from "./Login.tsx";

const Shell = ({ children }: { children: ComponentChildren }) => (
  <div style={{ textAlign: "center" }}>
    <h1>Blocktol</h1>
    {children}
  </div>
);

const getDate = () => {
  const date = new Date();
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
};

export const App = () => {
  const id = getId();
  const [username, setUsername] = useState<string>();
  const connection = useContext(ConnectionContext);
  const connected = useConnectionState();
  const logInTimeout = useRef<number>();

  useEffect(() => {
    if (connected && username) {
      clearTimeout(logInTimeout.current);
      connection.send({ kind: "login", username, id, date: getDate() });
    }
  }, [connected]);

  const gameState = useGameState();

  return (
    <Shell>
      {(username?.length ?? 0) > 0
        ? (
          <GameStateContext.Provider value={gameState}>
            <Game />
          </GameStateContext.Provider>
        )
        : (
          <>
            <IntroBoard />
            <Login
              connected={connection.connected}
              onLogin={(username) => {
                setUsername(username);
                if (connection.connected) {
                  logInTimeout.current = setTimeout(
                    () =>
                      connection.send({
                        kind: "login",
                        username,
                        id,
                        date: getDate(),
                      }),
                    250,
                  );
                }
              }}
            />
          </>
        )}
    </Shell>
  );
};
