import { is } from "../../common/typeguards.ts";
import { errText, log } from "../util/logging.ts";
import type { Handler } from "../util/Router.ts";
import { best } from "./iteration/best.ts";
import { boot } from "./boot.ts";
import { getBoard } from "./iteration/board.ts";
import { dayView } from "./dayView.ts";
import { getDailySummary } from "./iteration/daily.ts";
import { deleteAccount } from "./deleteAccount.ts";
import { discordInfo } from "./discord.ts";
import { exportData } from "./exportData.ts";
import { listIterations } from "./iteration/list.ts";
import { commitRun } from "./iteration/run/commit.ts";
import { setRunPinned } from "./iteration/run/pin.ts";
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
import { rivals } from "./rivals.ts";
import { reportClientError } from "./reportClientError.ts";
import { setSettings } from "./setSettings.ts";

const handlers = {
  boot,
  dayView,
  list: listIterations,
  getBoard,
  getDailySummary,
  startRun,
  updateRun,
  commitRun,
  setRunPinned,
  best,
  standings,
  getProfile,
  rivals,
  rename,
  merge,
  moveInfo,
  exportData,
  deleteAccount,
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

// The largest legitimate body is a commitRun/updateRun with a full 400-piece
// maze (the zod cap), ~13 KB of JSON. 64 KiB also fits a client error report's
// stack, and refuses a multi-MB body before it is buffered or parsed. Asserted
// against a real 400-piece body in api.test.ts.
export const MAX_BODY_BYTES = 64 * 1024;

// Read the body as text; null once it passes `limit` bytes. The declared
// content-length short-circuits the common case; the counted stream read covers
// a chunked or lying one, and cancels rather than drains the rest.
export const readBodyLimited = async (
  req: Request,
  limit: number,
): Promise<string | null> => {
  const declared = Number(req.headers.get("content-length"));
  if (declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const isStatusObj = is.object({ status: is.number });
const isErrorObj = is.object({ error: is.unknown });

export const api: Handler<"method"> = async (req, { method }) => {
  // Own keys only: `in` would match `constructor`, `toString`, `__proto__`.
  if (!Object.hasOwn(handlers, method)) {
    return Response.json({ error: "unknown method" }, { status: 404 });
  }

  const handler = handlers[method as keyof typeof handlers];
  const text = await readBodyLimited(req, MAX_BODY_BYTES);
  if (text === null) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
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
  // A handler that returns a 5xx without throwing (e.g. a failed DB write)
  // never reaches the Router's catch, so log it here. 4xxs are expected client
  // faults and stay unlogged.
  if (status >= 500) {
    log.error(req, `handler ${method} failed`, {
      status,
      error: isErrorObj(output) ? errText(output.error) : undefined,
    });
  }
  return Response.json(output, { status });
};
