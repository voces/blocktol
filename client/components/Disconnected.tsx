import { useEffect, useState } from "preact/compat";
import { h } from "preact";
import { t } from "../util/t.ts";

export const Disconnected = () => {
  const [ellipse, setEllipse] = useState(1);

  useEffect(() => {
    const interval = setInterval(
      () => setEllipse((e) => e % 3 + 1),
      500,
    );

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        color: "var(--maze-text)",
        fontSize: "200%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {t("common.connecting")}
      <span
        style={{ display: "inline-block", width: 0 }}
      >
        {".".repeat(ellipse)}
      </span>
    </div>
  );
};
