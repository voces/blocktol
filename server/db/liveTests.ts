import { env } from "../util/env.ts";
import process from "node:process";

// Whether the database integration tests run: only with SQL_PASSWORD set, and
// never against production. They play real dailies as throwaway `t-` users, so
// on prod they would enter real fields, ratings and Discord posts; APP_ENV=prod
// fails the import (loudly, not as a silent skip).
export const live = (() => {
  if (!process.env.SQL_PASSWORD) return false;
  if (env === "prod") {
    throw new Error("integration tests refuse to run with APP_ENV=prod");
  }
  return true;
})();
