/**
 * Position of a time in the field's range: (time - min) / (best - min), clamped
 * to [0, 1]. A field whose best doesn't exceed the floor has no range and
 * everyone stands at 1. Shared by the server and every client surface, so a
 * day's calendar cell matches the % shown when it's opened.
 */
export const standing = (time: number, min: number, best: number) =>
  best <= min ? 1 : Math.max(0, Math.min(1, (time - min) / (best - min)));
