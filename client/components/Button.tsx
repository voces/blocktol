import { h, JSX } from "preact";

export const Button = (
  { children, style, class: className, ...rest }: JSX.ButtonHTMLAttributes<
    HTMLButtonElement
  >,
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
