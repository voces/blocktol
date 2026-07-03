import { Handler } from "../util/Router.ts";

type LogData = {
  start: number;
};

export const logMap = new WeakMap<Request, LogData>();

export const beginLogger: Handler = (req, _, prev) => {
  logMap.set(req, { start: Date.now() });

  return prev;
};
