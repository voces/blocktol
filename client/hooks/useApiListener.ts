import { useEffect, useRef, useState } from "preact/compat";
import { api, MessageMap } from "../api.ts";

export const useApiListener = <Method extends keyof MessageMap>(
  method: Method,
  callback?: (data: MessageMap[Method]) => void,
) => {
  const [data, setData] = useState<MessageMap[Method]>();

  // Hold the latest callback in a ref so the listener can be registered ONCE
  // (per method) rather than re-subscribing every render. Re-subscribing mid-
  // render is what let a synchronous re-render inside a dispatch reshuffle the
  // emitter's listener list and drop an event (e.g. the getBoard that stages the
  // board after "keep playing").
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const listener = api.addEventListener(method, (data) => {
      setData(data);
      cbRef.current?.(data);
    });
    return () => api.removeEventListener(method, listener);
  }, [method]);

  return data;
};
