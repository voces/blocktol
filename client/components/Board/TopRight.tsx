import { Fragment, h, Ref } from "preact";

export const TopRight = ({ time }: { time: number }) => {
  if (time <= 0) return null;

  return (
    <text
      x={18.8}
      y={0.8}
      font-size={0.8}
      fill="var(--maze-text)"
      text-anchor="end"
    >
      {time} seconds to build
    </text>
  );
};
