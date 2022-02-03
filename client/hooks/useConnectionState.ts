import { useContext, useEffect, useState } from "preact/hooks";
import { ConnectionContext } from "../contexts/Connection.ts";

export const useConnectionState = () => {
  const connection = useContext(ConnectionContext);
  const [connected, setConnected] = useState(connection.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    connection.addEventListener("connect", onConnect);

    const onDisconnect = () => setConnected(false);
    connection.addEventListener("disconnect", onDisconnect);

    return () => {
      connection.removeEventListener("connect", onConnect);
      connection.removeEventListener("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setConnected(connection.connected), 100);

    return () => clearTimeout(timeout);
  }, []);

  return connected;
};
