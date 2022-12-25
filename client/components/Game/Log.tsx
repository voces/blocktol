import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/compat";
import { ComponentChildren, Fragment, h } from "preact";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { Colors, Markdown } from "./Markdown.tsx";
import { RunMessage } from "../../../common/serverToClientMessage.ts";
import { formatPercentile } from "../../../common/formatPercentile.ts";

const isTouchEvent = (
  e:
    | h.JSX.TargetedTouchEvent<HTMLDivElement>
    | h.JSX.TargetedMouseEvent<HTMLDivElement>,
): e is h.JSX.TargetedTouchEvent<HTMLDivElement> => e.type === "touchstart";

type Message = {
  source: string;
  message: string;
};

const Message = (
  { message, colors }: { message: Message; colors: Colors },
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

      navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([e.currentTarget.innerText], {
            type: "text/plain",
          }),
        }),
      ]);

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
  const connection = useContext(ConnectionContext);
  const colors = useRef<Colors>({}).current;
  const [log, setLog] = useState<Message[]>([]);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    const disconnectCallback = () =>
      setLog(
        (l) => [...l, {
          source: "server",
          message: "You've been disconnected.",
        }],
      );

    const runCallback = ({ duration, percent }: RunMessage) =>
      setLog((l) => [...l, {
        source: "server",
        message: `You lasted ${duration}s (${formatPercentile(percent)}%).`,
      }]);

    const listCallback = () => setShowList(true);

    connection.addEventListener("disconnect", disconnectCallback);
    connection.addEventListener("run", runCallback);
    connection.addEventListener("list", listCallback);

    return () => {
      connection.removeEventListener("disconnect", disconnectCallback);
      connection.removeEventListener("run", runCallback);
      connection.removeEventListener("list", listCallback);
    };
  }, [colors]);

  useEffect(
    () => scrollLogRef.current?.scrollIntoView({ behavior: "smooth" }),
    [log, scrollLogRef.current],
  );

  return (
    <div
      className={["log", showList && "show-list"].filter((v) => !!v).join(" ")}
    >
      {log.map((m) => <Message message={m} colors={colors} />)}
      <div ref={scrollLogRef} />
    </div>
  );
};
