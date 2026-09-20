import { UserError } from "./UserError.ts";

export const dailyParts = (timeZone: string) => {
  let parts: string[];
  try {
    parts = new Date().toLocaleDateString("en-US", { timeZone }).split("/");
  } catch {
    throw new UserError("invalid timeZone");
  }

  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  const year = parseInt(parts[2]);

  return { month, day, year };
};

// The caller's local calendar date as `YYYY-MM-DD` — the shape an iteration's
// `created` DATE is stored and compared as (see createIteration). Anything that
// asks "which dailies exist for THIS player" wants this, not the database's
// CURDATE(): the server runs UTC, so a player west of it spends the evening
// with a UTC "today" whose daily their local day hasn't reached, and a player
// east of it reaches their local today while UTC is still on the day before.
export const dailyDate = (timeZone: string) => {
  const { year, month, day } = dailyParts(timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
};

const pad = (n: number) => String(n).padStart(2, "0");
