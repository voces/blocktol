import { Handler } from "../util/Router.ts";
import { UserError } from "../util/UserError.ts";

export class AuthError extends UserError {}

const userIdContext = new WeakMap<Request, string>();

export const extractUserId: Handler = (req, _, prev) => {
  const userId = req.headers.get("authorization");
  if (userId) userIdContext.set(req, userId);
  return prev;
};

export const getUserId = (req: Request) => {
  const userId = userIdContext.get(req);
  if (!userId) return new AuthError("No authorization for request");
  return userId!;
};

export const getUserIdMaybe = (req: Request) => userIdContext.get(req);
