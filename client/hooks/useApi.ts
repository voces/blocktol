import type { BlocktolApi } from "../../common/api.ts";
import { api } from "../api.ts";
import { useCallback, useEffect, useState } from "preact/compat";

export const useApi = <Method extends keyof BlocktolApi>(
  method: Method,
  { skip = false, input }: {
    skip?: boolean;
    input: Parameters<BlocktolApi[Method]>[0];
  },
) => {
  type Return = Awaited<ReturnType<BlocktolApi[Method]>>;
  // deno-lint-ignore no-explicit-any
  type ReturnError = Extract<Return, { error: any }>;
  type ReturnSuccess = Exclude<Return, ReturnError>;

  const [data, setData] = useState<ReturnSuccess>();
  const [error, setError] = useState<ReturnError>();
  const [lastInput, setLastInput] = useState(input);

  useEffect(() => {
    api.addEventListener(method, setData);
    return () => api.removeEventListener(method, setData);
  }, [method]);

  useEffect(() => {
    if (!skip) {
      // deno-lint-ignore no-explicit-any
      api[method](lastInput as any).then((ret) => {
        // deno-lint-ignore no-explicit-any
        if ((ret as any).error) {
          setData(undefined);
          setError(ret as unknown as ReturnError);
        } else {
          setData(ret as unknown as ReturnSuccess);
          setError(undefined);
        }
      });
    }
  }, [lastInput, method, skip]);

  const request = useCallback(
    async (input?: Parameters<BlocktolApi[Method]>[0]) => {
      if (input !== undefined) setLastInput(input);
      // deno-lint-ignore no-explicit-any
      const result = await api[method]((input ?? lastInput) as any);
      // deno-lint-ignore no-explicit-any
      if ((result as any).error) {
        setData(undefined);
        setError(result as unknown as ReturnError);
      } else {
        setData(result as unknown as ReturnSuccess);
        setError(undefined);
      }
      return result;
    },
    [lastInput, method],
  );

  return { data, error, request };
};
