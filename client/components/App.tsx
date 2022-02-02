import { ComponentChildren, Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { ConnectionContext } from "../contexts/Connection.ts";
import { getId } from "../util/id.ts";
import { Game } from "./Game.tsx";
import { Login } from "./Login.tsx";

const Shell = ({ children }: { children: ComponentChildren }) => (
  <div style={{ textAlign: "center" }}>
    <h1>mazing contest</h1>
    {children}
  </div>
);

export const App = () => {
  const id = getId();
  const [username, setUsername] = useState<string>();
  const [connected, setConnected] = useState(false);
  const connection = useContext(ConnectionContext);

  useEffect(() => {
    const disconnectCallback = () => setConnected(false);
    connection.addEventListener("disconnect", disconnectCallback);

    const connectCallback = () => {
      setConnected(true);
      if (username) connection.send({ kind: "login", username, id });
    };
    connection.addEventListener("connect", connectCallback);

    return () => {
      connection.removeEventListener("disconnect", disconnectCallback);
      connection.removeEventListener("connect", connectCallback);
    };
  }, [username]);

  return (
    <Shell>
      {(username?.length ?? 0) > 0 ? <Game /> : (
        <Login
          connected={connected}
          onLogin={(username) => {
            setUsername(username);
            if (connected) {
              setTimeout(
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
