import { useCallback, useEffect, useState } from "preact/compat";
import { api, MessageMap } from "../api.ts";

export const useApiListener = <Method extends keyof MessageMap>(
  method: Method,
  callback?: (data: MessageMap[Method]) => void,
  inputs?: unknown[],
) => {
  const [data, setData] = useState<MessageMap[Method]>();

  const cb = useCallback(callback ?? (() => {}), inputs ?? [Math.random()]);

  useEffect(() => {
    const listener = api.addEventListener(method, (data) => {
      setData(data);
      cb(data);
    });
    return () => api.removeEventListener(method, listener);
  }, [method, callback]);

  return data;
};
