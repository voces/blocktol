const reverseInterpolate = (left: number, right: number, value: number) =>
  (value - left) / (right - left);

/**
 * Calulcates the percentile of a value through an array of numbers.
 * - If no data, return 1 if greater than or equal to min; otherwise return 0
 * - If value < data[0], interpolate from min to data[0] / length
 * - If value >= data[length], return 1
 * - If value = data[n], return (n + 0.5) / length (i.e., we're "split" on n)
 */
export const reverseTween = (
  data: number[],
  value: number,
  min: number,
): number => {
  if (data.length === 0) return value < min ? 0 : 1;
  if (value < data[0]) {
    if (value < min) return 0;
    return reverseInterpolate(min, data[0], value) / data.length;
  }
  const length = data.length - 1;
  if (value >= data[length]) return 1;

  let left = 0;
  let right = length;
  let middle = Math.floor((left + right) / 2);
  while (left <= right) {
    if (data[middle] < value) left = middle + 1;
    else if (data[middle] > value) right = middle - 1;
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

  // No match + did worse than not doing anything by shifted away from a thunder
  if (value <= min) return 0;

  const leftValue = data[middle];
  const rightValue = data[middle + 1];
  const relativePercent = reverseInterpolate(leftValue, rightValue, value);

  return (middle + relativePercent + 1) / data.length;
};
