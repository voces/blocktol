export const formatPercentile = (percentile: number | null | undefined) => {
  if (typeof percentile !== "number") return "??";
  const m = (percentile / 10).toFixed(10).match(
    /0\.[01]\d(?:(?:(?<=9)9)+|(?:(?<=0)0)+)?\d\d/,
  )
    ?.[0];
  if (m === undefined) return "??";
  const v = parseFloat(m) * 1000;

  if (v >= 100) return Math.round(v).toString();

  if (v > 99 || v < 1) {
    return (Math.round(v * 10 ** (m.length - 6)) / 10 ** (m.length - 6))
      .toString();
  }

  return Math.round(v).toString();
};
