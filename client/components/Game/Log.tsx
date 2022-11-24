import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/compat";
import { h } from "preact";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { LogMessage } from "../../../common/serverToClientMessage.ts";
import { Input } from "../Input.tsx";
import { Markdown } from "./Markdown.tsx";

const getWindowDimensions = () => {
  const { innerWidth: width, innerHeight: height } = window;
  return { width, height };
};

const useWindowDimensions = () => {
  const [windowDimensions, setWindowDimensions] = useState(
    () => {
      const dimensions = getWindowDimensions();
      document.documentElement.style.setProperty(
        "--vh",
        `${dimensions.height * 0.01}px`,
      );
      return dimensions;
    },
  );

  useEffect(() => {
    const handleResize = () => {
      const dimensions = getWindowDimensions();
      document.documentElement.style.setProperty(
        "--vh",
        `${dimensions.height * 0.01}px`,
      );
      setWindowDimensions(dimensions);
    };

    globalThis.addEventListener("resize", handleResize);
    return () => globalThis.removeEventListener("resize", handleResize);
  }, []);

  return windowDimensions;
};

const useLogLocation = () => {
  const { width, height: fullHeight } = useWindowDimensions();
  const height = fullHeight - 110;

  return width - height >= 300 || width > 1_000
    ? "side"
    : width - height <= -100
    ? "bottom"
    : "none";
};

export const Log = () => {
  const scrollLogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logLocation = useLogLocation();
  const connection = useContext(ConnectionContext);
  const [queue, setQueue] = useState<LogMessage[]>([]);
  const colors = useRef<Record<string, string | undefined>>({}).current;
  const [log, setLog] = useState<LogMessage[]>([]);

  useEffect(() => {
    const logCallback = (message: LogMessage) => {
      if (message.time > Date.now()) setQueue((q) => [...q, message]);
      else setLog((l) => [...l, message]);

      colors[message.source] = colors[message.source] ??
        `hsl(${Math.random() * 360} 100% 40%)`;
    };

    connection.addEventListener("log", logCallback);

    return () => connection.removeEventListener("log", logCallback);
  }, [colors]);

  useEffect(() => {
    let animationFrame = -1;
    const animate = () => {
      if (inputRef.current !== document.activeElement) {
        inputRef.current?.focus();
      }

      animationFrame = requestAnimationFrame(animate);
      const now = Date.now();
      const newMessages = queue.filter((m) => m.time <= now);
      if (newMessages.length) {
        setQueue((q) => q.filter((m) => m.time > now));
        setLog(Array.from(
          new Set(
            [...log, ...newMessages].sort((a, b) => a.time - b.time).slice(
              -100,
            ),
          ),
        ));
      }
    };
    animate();

    return () => cancelAnimationFrame(animationFrame);
  }, [log, queue, scrollLogRef.current]);

  useEffect(() => {
    scrollLogRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, scrollLogRef.current]);

  const onKeyDown = useCallback(
    (e: h.JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;

      const message = e.currentTarget.value.slice(0, 100);
      if (!message) return;
      e.currentTarget.value = "";

      connection.send({ kind: "chat", message });
    },
    [],
  );

  if (logLocation === "none") {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        textAlign: "left",
        fontSize: 14,
        right: 8,
        bottom: logLocation === "side" ? undefined : 8,
        width: logLocation === "side"
          ? "calc((100vw - min(800px, 100vw, calc(var(--vh, 1vh) * 100 - 110px))) / 2 - 16px)"
          : "calc(100% - 16px)",
        height: logLocation === "side"
          ? "min(800px, 100vw, calc(var(--vh, 1vh) * 100 - 110px))"
          : "calc(var(--vh, 1vh) * 100 - 100vw - 94.88px)",
      }}
    >
      <div style={{ flexGrow: 1, overflowY: "auto" }}>
        {log.filter((l) => l.time < Date.now()).map((l) => (
          <div
            style={{ wordBreak: "break-word", marginLeft: 16, textIndent: -16 }}
          >
            {l.source !== "server"
              ? (
                <span style={{ color: colors[l.source] }}>
                  {`${l.source}: `}
                </span>
              )
              : null}
            <Markdown message={l.message} colors={colors} />
          </div>
        ))}
        <div ref={scrollLogRef} />
      </div>
      {logLocation === "side" && (
        <Input
          ref={inputRef}
          style={{ width: "100%", flexGrow: 0 }}
          placeholder="Send a message"
          onKeyDown={onKeyDown}
          maxLength={100}
        />
      )}
    </div>
  );
};
