import { h } from "preact";

/**
 * The Blocktol mark. Single source is /favicon.svg (also the browser tab and
 * PWA icon); rendered here as an <img> so the in-app logo and the favicon can
 * never drift. Decorative — the adjacent "Blocktol" heading carries the name.
 */
export const Logo = ({ size = 20 }: { size?: number }) => (
  <img src="/favicon.svg" alt="" width={size} height={size} />
);
