// Avatar colours vary ONLY by hue; lightness and chroma are held constant in
// OKLCH — a perceptually-uniform space — so every colour reads with the same
// vividness and the same white-text contrast. (Fixed *HSL* wouldn't: a yellow
// at 50% lightness looks far lighter than a blue at 50%, and the contrast with
// the white initial would swing hue to hue.) The hue is chosen deterministically
// from the user id, so a player's colour is identical on every device without
// persisting anything.

// Held constant across all avatars. L 0.58 keeps the white initial comfortably
// readable (~3.5:1, AA for the large glyph) on every hue; C 0.15 stays in sRGB
// gamut all the way round the wheel (CSS gamut-maps any hue that doesn't).
const AVATAR_LIGHTNESS = 0.58;
const AVATAR_CHROMA = 0.15;

const hash = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const avatarColor = (seed: string) =>
  `oklch(${AVATAR_LIGHTNESS} ${AVATAR_CHROMA} ${hash(seed) % 360})`;

export const avatarInitial = (name: string | null | undefined) =>
  (name ?? "").trim().charAt(0).toUpperCase() || "?";
