import { h, JSX } from "preact";

export const Button = (
  { children, style, ...rest }: JSX.HTMLAttributes<HTMLButtonElement>,
) => {
  return (
    <button
      {...rest}
      style={{
        padding: 8,
        borderRadius: 4,
        margin: 1,
        backgroundColor: "var(--maze-checkpoint)",
        color: "white",
        fontWeight: "bold",
        border: 0,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        ...(typeof style === "object" ? style : undefined),
        opacity: rest.disabled ? 0.6 : undefined,
      }}
    >
      {children}
    </button>
  );
};
