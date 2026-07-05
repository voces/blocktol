import { h } from "preact";
import { useEffect, useState } from "preact/compat";
import { getId } from "../util/id.ts";

export const Profile = () => {
  const [copied, setCopied] = useState(false);
  const [timeout, setTimeoutId] = useState(-1);

  useEffect(() => () => clearTimeout(timeout), [timeout]);

  const onClick = () => {
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([
          new URL(`/login/${getId()}`, location.origin).href,
        ], { type: "text/plain" }),
      }),
    ]);

    setCopied(true);
    clearTimeout(timeout);
    setTimeoutId(setTimeout(() => setCopied(false), 1500));
  };

  return (
    <div class="profile" onClick={onClick} title="Copy login link">
      <span class="profile__avatar">👤</span>
      {copied && <div class="profile__tooltip">Copied login link!</div>}
    </div>
  );
};
