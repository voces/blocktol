import { UserError } from "./UserError.ts";

// A player's local calendar day, from the IANA zone their browser reports
// (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
//
// Only NAMED zones are accepted. ECMA-402 also takes raw offsets ("+14:00",
// "-23:59"), and "±23:59" would let a player claim a local day far beyond the
// real −12..+14 range, opening ranked attempts after `rate-dailies` has rated
// that day. Every IANA name and alias (`Asia/Calcutta`, `Etc/GMT+12`, `UTC`)
// starts with a letter, as sent and as resolved, while an offset resolves to
// "±HH:MM"; checking both ends rejects every offset spelling (ASCII or U+2212
// minus). No allowlist: `Intl.supportedValuesOf("timeZone")` omits legacy
// aliases real browsers still report.
const NAMED = /^[A-Za-z]/;

export const dailyParts = (timeZone: string) => {
  let parts: string[];
  try {
    if (!NAMED.test(timeZone)) throw new RangeError("offset time zone");
    const format = new Intl.DateTimeFormat("en-US", { timeZone });
    if (!NAMED.test(format.resolvedOptions().timeZone)) {
      throw new RangeError("offset time zone");
    }
    parts = format.format(new Date()).split("/");
  } catch {
    throw new UserError("invalid timeZone");
  }

  const month = parseInt(parts[0]!);
  const day = parseInt(parts[1]!);
  const year = parseInt(parts[2]!);

  return { month, day, year };
};
