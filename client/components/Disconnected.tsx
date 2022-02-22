import { h } from "preact";

export const Disconnected = () => (
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
    Disconnected
  </div>
);
