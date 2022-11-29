export const formatPercentile = (percentile: number) => {
  const m = (percentile * 100).toString().match(
    /\d+(?:\.[0-9])?(?:(?<=9)9*[0-8]?)*[0-9]/,
  )?.[0];
  if (!m) return "??";
  const v = parseFloat(m);

  if (v >= 100) return Math.round(v).toString();

  if (v > 99) {
    return (Math.round(v * 10 ** (m.length - 4)) / 10 ** (m.length - 4))
      .toString();
  }

  return Math.round(v).toString();
};
