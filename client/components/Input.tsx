import { Fragment, h, type JSX } from "preact";
import { forwardRef, useState } from "preact/compat";

export const Input = forwardRef<
  HTMLInputElement,
  // A plain style: it is merged into the input's own (no signal).
  & Omit<JSX.HTMLAttributes<HTMLInputElement>, "style">
  & { style?: string | JSX.CSSProperties }
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
          // A plain object: preact's CSSProperties maps CSSStyleDeclaration's
          // keys, Symbol.iterator included, so it reads as iterable.
          // oxlint-disable-next-line typescript/no-misused-spread
          ...(typeof style === "object" ? style : {}),
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
        ref={ref}
      />
    </>
  );
});
