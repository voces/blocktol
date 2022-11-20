import { useContext, useEffect, useState } from "preact/hooks";
import { h } from "preact";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { LogMessage } from "../../../common/serverToClientMessage.ts";

const getWindowDimensions = () => {
  const { innerWidth: width, innerHeight: height } = window;
  return {
    width,
    height,
  };
};

const useWindowDimensions = () => {
  const [windowDimensions, setWindowDimensions] = useState(
    getWindowDimensions(),
  );

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions(getWindowDimensions());
    };

    globalThis.addEventListener("resize", handleResize);
    return () => globalThis.removeEventListener("resize", handleResize);
  }, []);

  return windowDimensions;
};

const useLogLocation = () => {
  const { width, height: fullHeight } = useWindowDimensions();
  const height = fullHeight - 110;

  return width - height >= 300
    ? "side"
    : width - height <= -100
    ? "bottom"
    : "none";
};

export const Log = () => {
  const logLocation = useLogLocation();
  const connection = useContext(ConnectionContext);
  const [log, setLog] = useState<LogMessage[]>([]);

  useEffect(() => {
    const logCallback = (message: LogMessage) =>
      setLog((l) => [...l, message].sort((a, b) => a.time - b.time));

    connection.addEventListener("log", logCallback);

    return () => connection.removeEventListener("log", logCallback);
  }, []);

  if (logLocation === "none") {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        textAlign: "left",
        fontSize: 14,
        right: logLocation === "side" ? 8 : undefined,
        bottom: logLocation === "side" ? undefined : 8,
        width: logLocation === "side"
          ? "calc((100vw - min(800px, 100vw, calc(100vh - 110px))) / 2 - 16px)"
          : "100%",
        height: logLocation === "side"
          ? "min(800px, 100vw, calc(100vh - 110px))"
          : "calc(100vh - 100vw - 94.88px)",
      }}
    >
      {log.filter((l) => l.time < Date.now()).map((l) => <div>{l.message}
      </div>)}
    </div>
  );
};
