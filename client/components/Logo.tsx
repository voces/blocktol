import { h } from "preact";
import { memo } from "preact/compat";

/**
 * The Blocktol mark. Single source is /favicon.svg (also the browser tab and
 * PWA icon); rendered here as an <img> so the in-app logo and the favicon can
 * never drift. Decorative — the adjacent "Blocktol" heading carries the name.
 *
 * Memoized: the header sits above the game-state provider, so the build clock's
 * per-second tick would otherwise re-render this <img> and refetch the SVG.
 */
export const Logo = memo(({ size = 20 }: { size?: number }) => (
  <img src="/favicon.svg" alt="" width={size} height={size} />
));
