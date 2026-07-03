import { ComponentChildren, h, JSX } from "preact";

export const Card = (
  { children, style }: {
    children: ComponentChildren;
    style?: JSX.CSSProperties;
  },
) => (
  <div
    style={{
      borderRadius: 6,
      background: "var(--card-background)",
      boxShadow: "1px 1px 2px 1px rgba(0, 0, 0, 0.3)",
      padding: 8,
      margin: 4,
      ...style,
    }}
  >
    {children}
  </div>
);
