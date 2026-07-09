import { h } from "preact";

// The bell in the header. `filled` (there are unread) gets a solid clapper cue;
// the badge itself is drawn in CSS.
export const Bell = ({ filled }: { filled?: boolean }) => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={1.8}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.2 7.5-2.2 7.5h16.4S18 14.5 18 8.5Z" />
    <path
      d="M10.3 20a2 2 0 0 0 3.4 0"
      fill={filled ? "currentColor" : "none"}
    />
  </svg>
);

// The crown that fronts a "lost top spot" card (gold, per the record iconography
// elsewhere). Filled via currentColor so the tile controls the hue.
export const Crown = () => (
  <svg width={20} height={20} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 5l3 3 3-5 3 5 3-3-1 8H3z" fill="currentColor" />
  </svg>
);

// The flag that fronts a "daily finalized" card.
export const Flag = () => (
  <svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={2}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M5 21V4" />
    <path
      d="M5 4h11l-1.5 3.5L16 11H5"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);
