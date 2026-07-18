// Formatting for the standings dock/sheet, split out for unit tests. Each takes
// `now` so tests don't race the clock. The relative-time / countdown words route
// through the catalog (`time.*`) so they localize; English renders byte-for-byte
// the same, so the unit tests are unchanged.

import { formatDecimal } from "../../../common/format.ts";
import { t } from "../../util/t.ts";

// "T2" when the rank is shared, plain "2" otherwise. Large ranks (the PB
// board's thousands) collapse to an approximate "~1.9k" — exact digits there
// are noise, and the tie prefix drops since tie state is fuzzy at that scale.
// The "~1.9k" decimal localizes (a "." vs "," separator) like every other
// number; the plain rank is always < 1000, so it never takes a grouping mark.
export const formatRank = (rank: number, tied: boolean) => {
  if (rank >= 1000) {
    const k = Math.round(rank / 100) / 10;
    return `~${formatDecimal(k, { min: 0, max: 1 })}k`;
  }
  return `${tied ? "T" : ""}${rank}`;
};

// When a row's best was set — "now", "5m ago", "19h ago", "3d ago". Coarser
// than the runs panel's formatter on purpose: board rows span the whole field,
// so second precision and date fallbacks would just add noise.
export const formatAgo = (at: number, now = Date.now()) => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return t("time.now");
  const m = Math.floor(s / 60);
  if (m < 60) return t("time.minsAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hoursAgo", { h });
  return t("time.daysAgo", { d: Math.floor(h / 24) });
};

// Time left until the field closes and the day gets ranked — "9h 41m", then
// "41m", then "soon" once the close has passed but the rating cron hasn't
// swept it yet.
export const formatCountdown = (closesAt: number, now = Date.now()) => {
  const m = Math.ceil((closesAt - now) / 60_000);
  if (m <= 0) return t("time.soon");
  const h = Math.floor(m / 60);
  return h > 0
    ? t("time.countdownHm", { h, m: m % 60 })
    : t("time.countdownM", { m });
};

// The sheet's header date ("Jul 7") from the server's [y, m, d] day tuple.
// Built as a LOCAL date so locale formatting can't shift it across midnight.
export const formatDay = ([y, m, d]: readonly [number, number, number]) =>
  new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
