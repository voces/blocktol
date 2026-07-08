/**
 * Position of a time in the field's range — (time - min) / (best - min),
 * clamped to [0, 1]. A field whose best doesn't exceed the floor has no range:
 * everyone there stands at 1. The single definition shared by the server's
 * attempt shaping and every client surface (runs panel, calendar cells,
 * today-result), so a day's cell always matches the % shown when it's opened.
 */
export const standing = (time: number, min: number, best: number) =>
  best <= min ? 1 : Math.max(0, Math.min(1, (time - min) / (best - min)));
