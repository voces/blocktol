import { type ComponentChildren, h, type JSX } from "preact";

export const Card = (
  { children, style }: {
    children: ComponentChildren;
    style?: JSX.CSSProperties;
  },
) => (
  <div class="card" style={style}>
    {children}
  </div>
);
