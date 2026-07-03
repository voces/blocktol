import { h, JSX } from "preact";

export const Block = (
  { x, y, color, opacity, style, size = 2 }: {
    x: number;
    y: number;
    color:
      | "upgrade-to-thunder"
      | "player-block"
      | "game-block"
      | "player-thunder"
      | "game-thunder"
      | "placing-block"
      | "placing-error";
    opacity?: number;
    size?: 1 | 2;
    style?: JSX.CSSProperties;
  },
) => (
  <rect
    x={x}
    y={y}
    width={size}
    height={size}
    fill={`var(--maze-${color})`}
    opacity={opacity}
    stroke="var(--maze-stroke)"
    stroke-width={0.1}
    style={style}
  />
);
