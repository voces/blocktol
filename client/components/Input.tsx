import { useState } from "preact/hooks";
import { Fragment, h, JSX } from "preact";
import { useTheme } from "../hooks/useTheme.ts";

export const Input = (
  { style, onFocus, onBlur, ...rest }: JSX.HTMLAttributes<
    HTMLInputElement
  >,
) => {
  const [hasFocus, setFocused] = useState(false);
  const theme = useTheme();

  return (
    <>
      <input
        {...rest}
        style={{
          border: 0,
          borderBottom: "2px solid #bbb",
          fontSize: "inherit",
          outline: "none",
          ...(typeof style === "object" && style),
          ...(hasFocus && {
            borderBottomColor: theme.primary,
            backgroundColor: `rgba(${theme.primary}, 0.5)`,
          }),
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.call(e.currentTarget as never, e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.call(e.currentTarget as never, e);
        }}
      />
    </>
  );
};
