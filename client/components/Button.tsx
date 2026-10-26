import { h, type JSX } from "preact";

export const Button = (
  { children, style, class: className, ...rest }:
    & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class">
    // A plain class string: joined into the button's own classes.
    & { class?: string },
) => {
  return (
    <button
      {...rest}
      class={["btn", "tapc", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </button>
  );
};
