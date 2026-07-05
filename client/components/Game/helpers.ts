import { is } from "../../../common/typeguards.ts";

export const isTouchSource = is.object({
  sourceCapabilities: is.object({ firesTouchEvents: is.const(true) }),
});

export const randomColor = () =>
  `hsl(${Math.random() * 360} 100% var(--brightness))`;

/**
 * Whether a client point falls on the board's border/wall band (the outer
 * one-unit ring of the 20x20 viewBox) rather than the interior play area.
 * Touches there should not trigger board interaction (placing blocks, zoom),
 * leaving the HUD controls drawn on the border free to handle their own taps.
 */
export const isBorderPoint = (
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
) => {
  if (!svg) return false;
  const box = svg.getBoundingClientRect();
  const x = (clientX - box.x) / box.width * 20;
  const y = (clientY - box.y) / box.height * 20;
  return x < 1 || x > 19 || y < 1 || y > 19;
};
