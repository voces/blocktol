import { useCallback, useEffect, useRef, useState } from "preact/compat";
import { ComponentChildren, Fragment, h } from "preact";
import { Colors } from "./Markdown.tsx";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { useGameListener } from "../../hooks/useGame.ts";

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

      const rect = e.currentTarget.getBoundingClientRect();
      const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
      setTooltip({
        left: ("clientX" in e ? e.clientX : e.touches[0].clientX) -
          parentRect.left,
        top: e.currentTarget.offsetTop +
          (("clientY" in e ? e.clientY : e.touches[0].clientY) - rect.top),
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
      >
        {message.source !== "server"
          ? (
            <span style={{ color: colors[message.source] }}>
              {`${message.source}: `}
            </span>
          )
          : null}
        {message.message}
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
              transform: "translate(-50%, -100%)",
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
  const colors = useRef<Colors>({}).current;
  const [log, setLog] = useState<Message[]>([]);
  const [showList, setShowList] = useState(false);
  const [best, setBest] = useState(-1);
  const [min, setMin] = useState(-1);

  useApiListener("list", () => setShowList(true));
  useApiListener(
    "getDailySummary",
    (e) => {
      if (!e.currentRun) return;
      setBest(e.currentRun.best);
      setMin(e.currentRun.min);
    },
  );
  useApiListener("startRun", (e) => {
    setBest(e.best);
    setMin(e.min);
  });

  useGameListener("runStart", ({ duration }) => {
    const max = Math.max(duration, best);
    const percent = max === min ? 1 : (duration - min) / (max - min);
    // "longer than everyone else" = you set a new longest round. `best` is the
    // own-inclusive max, so this stays consistent with the percent above (which
    // hits 100% on the same run) — a run that beats others but not your own best
    // reads e.g. "99.5%." without the boast.
    const longest = duration > best;
    setLog((l) => [...l, {
      source: "server",
      message: `You lasted ${duration}s (${formatPercentile(percent)}%)${
        longest ? ", which was longer than everyone else!" : "."
      }`,
    }]);
  }, [best, min]);

  useEffect(
    () => scrollLogRef.current?.scrollIntoView({ behavior: "smooth" }),
    [log, scrollLogRef.current],
  );

  useApiListener("error", () =>
    setLog(
      (l) => [...l, {
        source: "server",
        message: "An error occured and has been automatically logged.",
      }],
    ));

  return (
    <div
      className={["log", showList && "show-list"].filter((v) => !!v).join(" ")}
    >
      {log.map((m) => <Message message={m} colors={colors} />)}
      <div ref={scrollLogRef} />
    </div>
  );
};
