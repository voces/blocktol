import { Handler } from "./Router.ts";

export const auth = <
  Result extends Record<string, unknown> | Response | undefined,
  Context extends Record<string, unknown>,
>(
  handler: Handler<Context & { userId: string }, Result>,
): Handler<Context, Result | Response> =>
(req, params, prev) => {
  const userId = req.headers.get("userid");
  if (!userId) return new Response(undefined, { status: 401 });
  return handler(req, { ...params, userId }, prev);
};
