import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/compat";
import { ComponentChildren, Fragment, h } from "preact";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { LogMessage } from "../../../common/serverToClientMessage.ts";
import { Input } from "../Input.tsx";
import { Colors, Markdown } from "./Markdown.tsx";
import { randomColor } from "./helpers.ts";

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

const isTouchEvent = (
  e:
    | h.JSX.TargetedTouchEvent<HTMLDivElement>
    | h.JSX.TargetedMouseEvent<HTMLDivElement>,
): e is h.JSX.TargetedTouchEvent<HTMLDivElement> => e.type === "touchstart";

const Message = (
  { message, colors }: { message: LogMessage; colors: Colors },
) => {
  const [tooltip, setTooltip] = useState<
    { left: number; top: number; tooltip: ComponentChildren } | null
  >(null);
  const [timeout, setTimeoutId] = useState(-1);

  useEffect(() => () => clearTimeout(timeout), [timeout]);

  const clipboardHandler = useCallback(
    (
      e:
        | h.JSX.TargetedTouchEvent<HTMLDivElement>
        | h.JSX.TargetedMouseEvent<HTMLDivElement>,
    ) => {
      e.preventDefault();
      e.stopPropagation();

      if (!("clipboard" in navigator)) return;

      navigator.clipboard.write(
        [
          new ClipboardItem({
            "text/plain": new Blob([e.currentTarget.innerText], {
              type: "text/plain",
            }),
            "text/html": new Blob([e.currentTarget.innerHTML], {
              type: "text/html",
            }),
          }),
        ],
      );

      const rect = e.currentTarget.parentElement!.parentElement!
        .getBoundingClientRect();
      setTooltip({
        left: (isTouchEvent(e) ? e.touches[0].clientX : e.clientX) - rect.left -
          20,
        top: (isTouchEvent(e) ? e.touches[0].clientY : e.clientY) - rect.top -
          20,
        tooltip: "Copied!",
      });
      setTimeoutId(setTimeout(() => setTooltip(null), 750));
    },
    [],
  );

  return (
    <>
      <div
        style={{
          wordBreak: "break-word",
          marginLeft: 16,
          textIndent: -16,
          cursor: "pointer",
        }}
        onMouseDown={clipboardHandler}
        onTouchStart={clipboardHandler}
      >
        {message.source !== "server"
          ? (
            <span style={{ color: colors[message.source] }}>
              {`${message.source}: `}
            </span>
          )
          : null}
        <Markdown message={message.message} colors={colors} />
      </div>
      {tooltip
        ? (
          <div
            style={{
              position: "absolute",
              left: tooltip.left,
              top: tooltip.top,
              color: "white",
              background: "#444d",
              borderRadius: 2,
              padding: "1px 2px",
            }}
          >
            {tooltip.tooltip}
          </div>
        )
        : null}
    </>
  );
};

export const Log = () => {
  const scrollLogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logLocation = useLogLocation();
  const connection = useContext(ConnectionContext);
  const [queue, setQueue] = useState<LogMessage[]>([]);
  const colors = useRef<Colors>({}).current;
  const [log, setLog] = useState<LogMessage[]>([]);

  useEffect(() => {
    const logCallback = (message: LogMessage) => {
      if (message.time > Date.now()) setQueue((q) => [...q, message]);
      else setLog((l) => [...l, message]);

      colors[message.source] = colors[message.source] ?? randomColor();
    };

    const disconnectCallback = () => {
      setLog(
        (l) => [...l, {
          kind: "log",
          source: "server",
          message: "You've been disconnected.",
          time: Date.now(),
        }],
      );
    };

    connection.addEventListener("log", logCallback);
    connection.addEventListener("disconnect", disconnectCallback);

    return () => {
      connection.removeEventListener("log", logCallback);
      connection.removeEventListener("disconnect", disconnectCallback);
    };
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
        {log.filter((m) => m.time < Date.now()).map((m) => (
          <Message message={m} colors={colors} />
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
