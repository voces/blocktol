// ELO-style rating math. A player is scored on where their best daily time
// ranks in the field (a percentile in [0, 1]), not on win/loss. Their rating
// implies an *expected* percentile: beating it raises the rating, falling short
// lowers it.

export const K = 64;

// Maps a rating to the percentile the player is "expected" to reach:
//   0 -> 0,  415 -> 0.25,  1000 -> 0.5,  2000 -> 0.75,  3000 -> 0.875
export const expectedPercentile = (rating: number) =>
  1 - 0.5 ** (rating / 1000);

// The rating delta for one daily. `plays` is the count of previously rated
// dailies; the K-factor `K / log2(plays + 2)` decays with it, so new players
// move fast and settle.
export const computeRatingChange = (
  rating: number,
  plays: number,
  actualPercentile: number,
) => K / Math.log2(plays + 2) * (actualPercentile - expectedPercentile(rating));
