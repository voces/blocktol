import { h } from "preact";

// The record crown — gold, reserved for a #1 that beat everyone outright.
export const Crown = () => (
  <svg
    class="standings-crown"
    width="14"
    height="14"
    viewBox="0 0 16 16"
    aria-label="record"
  >
    <path d="M2 5l3 3 3-5 3 5 3-3-1 8H3z" fill="var(--gold)" />
  </svg>
);

// The dock's expand affordance: an up-caret on mobile (the sheet rises from the
// bottom), rotated to point left on desktop where the sheet is a side drawer
// (see .standings-dock__chevron in the desktop media query).
export const Chevron = () => (
  <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden="true">
    <path
      d="M1 7.5L7 1.5L13 7.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
