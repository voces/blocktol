const reverseInterpolate = (left: number, right: number, value: number) =>
  (value - left) / (right - left);

/**
 * The percentile of `value` in ascending `data`, interpolating between
 * neighbours. `min` is the practical floor: anything below it scores 0.
 * - No data: 1 if `value >= min`, else 0.
 * - `value < data[0]`: interpolate from `min` up to `data[0]`, over `length`.
 * - `value >= ` the last element: 1.
 * - Matching a run of duplicates: the middle of that run, split evenly.
 */
export const reverseTween = (
  data: number[],
  value: number,
  min: number,
): number => {
  if (data.length === 0) return value < min ? 0 : 1;
  if (value < data[0]!) {
    if (value < min) return 0;
    return reverseInterpolate(min, data[0]!, value) / data.length;
  }
  const length = data.length - 1;
  if (value >= data[length]!) return 1;

  let left = 0;
  let right = length;
  let middle = Math.floor((left + right) / 2);
  while (left <= right) {
    if (data[middle]! < value) left = middle + 1;
    else if (data[middle]! > value) right = middle - 1;
    else break;

    middle = Math.floor((left + right) / 2);
  }

  // Exact match, find center for duplicates
  if (value === data[middle]) {
    left = middle;
    while (data[left - 1] === value) left--;
    right = middle;
    while (data[right + 1] === value) right++;
    return (left + right + 1) / 2 / data.length;
  }

  // Between two entries but at or below the unobstructed time `min`.
  if (value <= min) return 0;

  const leftValue = data[middle]!;
  const rightValue = data[middle + 1]!;
  const relativePercent = reverseInterpolate(leftValue, rightValue, value);

  return (middle + relativePercent + 1) / data.length;
};

/**
 * From a field of `{ time, count }` ascending by time, a map from each time to
 * the percentile a player *at* that time gets with their own run excluded: the
 * batch form of `percentileFromTimeCounts` per player, in one O(field) pass.
 * Empty when the field has a single run (nothing left to rank against).
 */
export const selfExcludedPercentiles = (
  field: { time: number; count: number }[],
) => {
  const total = field.reduce((sum, c) => sum + c.count, 0);
  const percentiles = new Map<number, number>();
  let less = 0;
  for (const { time, count } of field) {
    const denominator = total - 1; // one run (self) removed
    if (denominator > 0) {
      const more = total - less - count;
      percentiles.set(
        time,
        more === 0 ? 1 : (less + (count - 1) / 2) / denominator,
      );
    }
    less += count;
  }
  return percentiles;
};

/**
 * The times at the 25th/50th/75th percentile of an ascending `{ time, count }`
 * field, or null when it has fewer than 4 runs.
 */
export const fieldQuantiles = (
  timeCounts: { time: number; count: number }[],
) => {
  const total = timeCounts.reduce((sum, c) => sum + c.count, 0);
  if (total < 4) return null;

  const at = (fraction: number) => {
    const target = fraction * total;
    let cumulative = 0;
    for (const { time, count } of timeCounts) {
      cumulative += count;
      if (cumulative >= target) return time;
    }
    throw new RangeError(`quantile ${fraction} is past the field`);
  };

  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
};

// The share of the field `duration` beats, ties counting half. `timeCounts` is
// the OTHER runs (callers exclude the player's own). Undefined when the field
// is empty; 1 when nothing is longer.
export const percentileFromTimeCounts = (
  timeCounts: { time: number; count: number }[],
  duration: number,
) => {
  let less = 0;
  let equal = 0;
  let more = 0;
  for (const { time, count } of timeCounts) {
    if (time < duration) less += count;
    else if (time === duration) equal += count;
    else more += count;
  }

  const denominator = less + equal + more;

  // Nobody to compare against yet.
  if (denominator === 0) return;

  if (more === 0) return 1;

  return (less + equal / 2) / denominator;
};
