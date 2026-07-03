import { is } from "../../common/typeguards.ts";

// `APP_ENV`, not `DENO_ENV`: the new Deno Deploy reserves the `DENO_` prefix,
// so custom `DENO_*` names can't be set in the dashboard.
const envFromEnv = Deno.env.get("APP_ENV");

const isValidEnv = is.union(
  is.undefined,
  is.const("local"),
  is.const("dev"),
  is.const("prod"),
);

if (!isValidEnv(envFromEnv)) throw new Error(`Unknown env ${envFromEnv}`);

export const env = envFromEnv ?? "local";

export type Env = typeof env;
