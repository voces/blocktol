import { h, JSX } from "preact";
import { ThemeColor } from "../contexts/Theme.ts";
import { useTheme } from "../hooks/useTheme.ts";

export const Button = (
  { children, color, style, ...rest }: JSX.HTMLAttributes<HTMLButtonElement> & {
    color?: ThemeColor;
  },
) => {
  const theme = useTheme();

  return (
    <button
      {...rest}
      style={{
        padding: 8,
        borderRadius: 4,
        margin: 1,
        backgroundColor: theme[color ?? "primary"],
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
