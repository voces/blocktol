import { useEffect } from "preact/hooks";
import { ComponentProps, h } from "preact";
import { Button } from "./Button.tsx";

export const Action = (
  { name, hotkey, icon, handler, ...rest }: ComponentProps<typeof Button> & {
    name: string;
    hotkey: string;
    icon?: string;
    handler: () => void;
  },
) => {
  useEffect(() => {
    const callback = (e: KeyboardEvent) => {
      if (e.code === `Key${hotkey.toUpperCase()}`) handler();
    };

    globalThis.addEventListener("keydown", callback);

    return () => globalThis.removeEventListener("keydown", callback);
  }, [hotkey]);

  return (
    <Button onClick={handler} {...rest}>
      {name.slice(0, name.indexOf(hotkey))}
      <span style={{ color: "gold" }}>{hotkey}</span>
      {name.slice(name.indexOf(hotkey) + 1)} {icon}
    </Button>
  );
};
