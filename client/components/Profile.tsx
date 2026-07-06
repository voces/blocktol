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
    <button
      type="button"
      class="profile icon-button tapc"
      onClick={onClick}
      title="Copy login link"
      aria-label="Copy login link"
    >
      <svg
        class="profile__avatar"
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx={12} cy={8} r={4} />
        <path d="M12 14c-4.42 0-7.5 2.5-7.5 5.6 0 .77.63 1.4 1.4 1.4h12.2c.77 0 1.4-.63 1.4-1.4C19.5 16.5 16.42 14 12 14Z" />
      </svg>
      {copied && <div class="profile__tooltip">Copied login link!</div>}
    </button>
  );
};
