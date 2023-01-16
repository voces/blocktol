import { is } from "../../common/typeguards.ts";
import { Handler } from "../util/Router.ts";
import { best } from "./iteration/best.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { listIterations } from "./iteration/list.ts";
import { startRun } from "./iteration/run/start.ts";
import { updateRun } from "./iteration/run/update.ts";

const handlers = {
  list: listIterations,
  getDailySummary,
  startRun,
  updateRun,
  best,
};

export type BlocktolApi = {
  [Method in keyof typeof handlers]: (
    input: Parameters<typeof handlers[Method]["handler"]>[0],
  ) => Promise<
    Awaited<ReturnType<typeof handlers[Method]["handler"]>>
  >;
};

const isStatusObj = is.object({ status: is.number });

export const api: Handler<"method"> = async (req, { method }) => {
  if (!(method in handlers)) {
    return Response.json({ error: "unknown method" }, { status: 404 });
  }

  const handler = handlers[method as keyof typeof handlers];
  const text = await req.text();
  let body: unknown;
  try {
    if (text !== "") body = JSON.parse(text);
  } catch { /* do nothing */ }
  const result = handler.validation.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  // deno-lint-ignore no-explicit-any
  const output = await handler.handler(result.data as any, req);
  let status = 200;
  if (isStatusObj(output)) status = output.status;
  return Response.json(output, { status });
};
