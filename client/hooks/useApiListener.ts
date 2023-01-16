import { useEffect, useState } from "preact/compat";
import { api, MessageMap } from "../api.ts";

export const useApiListener = <Method extends keyof MessageMap>(
  method: Method,
  callback?: (data: MessageMap[Method]) => void,
) => {
  const [data, setData] = useState<MessageMap[Method]>();

  useEffect(() => {
    const listener = api.addEventListener(method, (data) => {
      setData(data);
      callback?.(data);
    });
    return () => api.removeEventListener(method, listener);
  }, [method, callback]);

  return data;
};
