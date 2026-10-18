import { h } from "preact";
import { memo } from "preact/compat";

/**
 * The Blocktol mark, an <img> of /favicon.svg so the logo and favicon can't
 * drift. Decorative: the adjacent heading carries the name.
 *
 * Memoized: the header sits above the game-state provider, so the build clock's
 * per-second tick would otherwise re-render this <img> and refetch the SVG.
 */
export const Logo = memo(({ size = 20 }: { size?: number }) => (
  <img src="/favicon.svg" alt="" width={size} height={size} />
));
