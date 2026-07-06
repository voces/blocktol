import { useEffect, useState } from "preact/compat";

/** Reactively tracks whether a CSS media query currently matches. */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() =>
    globalThis.matchMedia?.(query).matches ?? false
  );

  useEffect(() => {
    const mq = globalThis.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
};
