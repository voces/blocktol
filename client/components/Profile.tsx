import { ComponentChildren, Fragment, h, JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/compat";
import { getId } from "../util/id.ts";

const style = {
  position: "absolute",
  right: 16,
  top: 30,
  color: "transparent",
  textShadow: "0 0 0 var(--color)",
};

export const Profile = () => {
  const [tooltip, setTooltip] = useState<
    { left: number; top: number; tooltip: ComponentChildren } | null
  >(null);
  const [timeout, setTimeoutId] = useState(-1);

  useEffect(() => () => clearTimeout(timeout), [timeout]);

  const onClick = useCallback((e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([
          new URL(`/login/${getId()}`, location.origin).href,
        ], { type: "text/plain" }),
      }),
    ]);

    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    setTooltip({
      left: e.clientX - rect.left - 100,
      top: e.clientY - rect.top + 0,
      tooltip: "Copied login link!",
    });
    setTimeoutId(setTimeout(() => setTooltip(null), 1500));
  }, []);

  return (
    <>
      <span style={style} onClick={onClick}>👤</span>
      {tooltip && (
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
      )}
    </>
  );
};
