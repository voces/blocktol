import { is } from "../../common/typeguards.ts";
import process from "node:process";

const envFromEnv = process.env.APP_ENV;

const isValidEnv = is.union(
  is.undefined,
  is.const("local"),
  is.const("dev"),
  is.const("prod"),
);

if (!isValidEnv(envFromEnv)) throw new Error(`Unknown env ${envFromEnv}`);

export const env = envFromEnv ?? "local";

export type Env = typeof env;
