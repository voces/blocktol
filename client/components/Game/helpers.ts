import { is } from "../../../common/typeguards.ts";

export const isTouchSource = is.object({
  sourceCapabilities: is.object({ firesTouchEvents: is.const(true) }),
});

export const randomColor = () =>
  `hsl(${Math.random() * 360} 100% ${
    window.matchMedia("(prefers-color-scheme: dark)").matches ? 70 : 40
  }%)`;
