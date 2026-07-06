// A curated set of avatar backgrounds — each dark/saturated enough that white
// text reads on it. Picked deterministically from a stable seed (the user id)
// so a player's colour is identical on every device without persisting it.
const AVATAR_COLORS = [
  "hsl(268, 50%, 55%)", // violet
  "hsl(222, 68%, 55%)", // blue
  "hsl(196, 66%, 44%)", // cyan
  "hsl(168, 55%, 38%)", // teal
  "hsl(140, 52%, 40%)", // green
  "hsl(96, 48%, 42%)", // olive
  "hsl(42, 82%, 44%)", // amber
  "hsl(22, 78%, 50%)", // orange
  "hsl(2, 66%, 55%)", // red
  "hsl(330, 58%, 52%)", // pink
  "hsl(300, 46%, 50%)", // magenta
  "hsl(238, 46%, 58%)", // indigo
];

const hash = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const avatarColor = (seed: string) =>
  AVATAR_COLORS[hash(seed) % AVATAR_COLORS.length];

export const avatarInitial = (name: string | null | undefined) =>
  (name ?? "").trim().charAt(0).toUpperCase() || "?";
