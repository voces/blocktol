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
