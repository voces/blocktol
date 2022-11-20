import { Fragment, h, JSX } from "preact";
import { forwardRef, useState } from "preact/compat";

export const Input = forwardRef<
  HTMLInputElement,
  JSX.HTMLAttributes<HTMLInputElement>
>((
  { style, onFocus, onBlur, ...rest },
  ref,
) => {
  const [hasFocus, setFocused] = useState(false);

  return (
    <>
      <input
        {...rest}
        style={{
          border: 0,
          borderBottom: "2px solid #bbb",
          fontSize: "inherit",
          backgroundColor: "inherit",
          color: "inherit",
          outline: "none",
          ...(typeof style === "object" && style),
          ...(hasFocus && {
            borderBottomColor: "var(--maze-checkpoint)",
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
        ref={ref as any}
      />
    </>
  );
});
