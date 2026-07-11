import { is } from "../../common/typeguards.ts";
import { reportError } from "../util/newrelic.ts";
import { Handler } from "../util/Router.ts";
import { best } from "./iteration/best.ts";
import { getBoard } from "./iteration/board.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { discordInfo } from "./discord.ts";
import { listIterations } from "./iteration/list.ts";
import { abandonRun } from "./iteration/run/abandon.ts";
import { commitRun } from "./iteration/run/commit.ts";
import { startRun } from "./iteration/run/start.ts";
import { updateRun } from "./iteration/run/update.ts";
import { standings } from "./iteration/standings.ts";
import { merge } from "./merge.ts";
import { moveInfo } from "./moveInfo.ts";
import { getNotifications } from "./notifications/list.ts";
import { markNotificationsRead } from "./notifications/markRead.ts";
import { getProfile } from "./profile.ts";
import { pushConfig } from "./push/config.ts";
import { subscribePush } from "./push/subscribe.ts";
import { unsubscribePush } from "./push/unsubscribe.ts";
import { rename } from "./rename.ts";
import { reportClientError } from "./reportClientError.ts";
import { setSettings } from "./setSettings.ts";

const handlers = {
  list: listIterations,
  getBoard,
  getDailySummary,
  startRun,
  updateRun,
  abandonRun,
  commitRun,
  best,
  standings,
  getProfile,
  rename,
  merge,
  moveInfo,
  reportClientError,
  setSettings,
  getNotifications,
  markNotificationsRead,
  discordInfo,
  pushConfig,
  subscribePush,
  unsubscribePush,
};

export type BlocktolApi = {
  [Method in keyof typeof handlers]: (
    input: Parameters<typeof handlers[Method]["handler"]>[0],
  ) => Promise<
    Awaited<ReturnType<typeof handlers[Method]["handler"]>>
  >;
};

const isStatusObj = is.object({ status: is.number });
const isErrorObj = is.object({ error: is.unknown });

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
  // A handler that returns a 5xx (e.g. a DB write that failed) surfaces a real
  // server fault without throwing — the Router catch never sees it — so report
  // it here. 4xxs are expected client faults (bad input, auth, expired window)
  // and stay unreported.
  if (status >= 500) {
    reportError({
      source: "server",
      message: `handler ${method} failed`,
      attributes: {
        method,
        status,
        error: isErrorObj(output) ? output.error : undefined,
      },
    });
  }
  return Response.json(output, { status });
};
