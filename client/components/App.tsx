import { ComponentChildren, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { ConnectionContext } from "../contexts/Connection.ts";
import { useConnectionState } from "../hooks/useConnectionState.ts";
import { getId } from "../util/id.ts";
import { Game } from "./Game.tsx";
import { Login } from "./Login.tsx";

const Shell = ({ children }: { children: ComponentChildren }) => (
  <div style={{ textAlign: "center" }}>
    <h1>Blocktol</h1>
    {children}
  </div>
);

export const App = () => {
  const id = getId();
  const [username, setUsername] = useState<string>();
  const connection = useContext(ConnectionContext);
  const connected = useConnectionState();
  const logInTimeout = useRef<number>();

  useEffect(() => {
    if (connected && username) {
      clearTimeout(logInTimeout.current);
      connection.send({ kind: "login", username, id });
    }
  }, [connected]);

  return (
    <Shell>
      {(username?.length ?? 0) > 0 ? <Game /> : (
        <Login
          connected={connection.connected}
          onLogin={(username) => {
            setUsername(username);
            if (connection.connected) {
              logInTimeout.current = setTimeout(
                () => connection.send({ kind: "login", username, id }),
                250,
              );
            }
          }}
        />
      )}
    </Shell>
  );
};
