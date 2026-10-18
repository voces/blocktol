// Avatar colours vary ONLY by hue; lightness and chroma are constant in OKLCH,
// which is perceptually uniform, so every colour has the same vividness and
// white-text contrast (fixed HSL lightness would not). The hue derives from the
// user id, so a player's colour is the same on every device with nothing
// persisted.
//
// Shared because the server derives hues too: standings ship other players'
// hues WITHOUT their user ids, which are bearer credentials, and the client
// renders from the hue alone.

// L 0.58 keeps the white initial readable (~3.5:1, AA for the large glyph) on
// every hue; C 0.15 stays in sRGB gamut around the whole wheel.
const AVATAR_LIGHTNESS = 0.58;
const AVATAR_CHROMA = 0.15;

const hash = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const avatarHue = (seed: string) => hash(seed) % 360;

export const avatarColorFromHue = (hue: number) =>
  `oklch(${AVATAR_LIGHTNESS} ${AVATAR_CHROMA} ${hue})`;

export const avatarColor = (seed: string) =>
  avatarColorFromHue(avatarHue(seed));

export const avatarInitial = (name: string | null | undefined) =>
  (name ?? "").trim().charAt(0).toUpperCase() || "?";
