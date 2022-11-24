import { useState } from "preact/compat";

/**
 * Similar to useRef, except internally uses state to queue a re-render when
 * the value is changed.
 */
export const useRefState = <T>(initial: T): { current: T } => {
  const [state, setState] = useState<T>(initial);

  const obj = {};
  Object.defineProperty(obj, "current", {
    enumerable: true,
    set(value) {
      setState(value);
    },
    get(): T {
      return state;
    },
  });

  return obj as { current: T };
};
