import { h } from "preact";
import { useRef, useState } from "preact/compat";
import { getId } from "../util/id.ts";
import { Logo } from "./Logo.tsx";
import { QrCode } from "./QrCode.tsx";

const CopyIcon = () => (
  <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linecap="round"
    >
      <rect x={5.5} y={1.5} width={9} height={9} rx={2} />
      <path d="M10.5 12.5v1a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 3 5.5h1" />
    </g>
  </svg>
);

const ShieldIcon = () => (
  <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
    <path
      d="M9 1.8l7 3v4.2c0 3.4-2.8 5.9-7 7.2-4.2-1.3-7-3.8-7-7.2V4.8z"
      fill="none"
      stroke="var(--warn)"
      stroke-width={1.4}
      stroke-linejoin="round"
    />
    <line
      x1={9}
      y1={6}
      x2={9}
      y2={9.6}
      stroke="var(--warn)"
      stroke-width={1.4}
      stroke-linecap="round"
    />
    <circle cx={9} cy={12} r={0.85} fill="var(--warn)" />
  </svg>
);

/**
 * The "move to another device" sheet: a QR of the sign-in link plus the link
 * itself to copy. Scanning it (or opening the link) signs the other device in as
 * this user — see the `/l/:id` route and getId(). It opens over the profile
 * dialog; back and close both return to it.
 */
export const MoveDevice = (
  { name, onClose }: { name: string; onClose: () => void },
) => {
  const url = new URL("/l/" + getId(), location.origin).href;
  const display = url.replace(/^https?:\/\//, "");
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef(-1);

  const copy = () => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="move" onClick={onClose}>
      <div class="move__sheet" onClick={(e) => e.stopPropagation()}>
        <div class="move__grab" aria-hidden="true" />
        <div class="move__head">
          <button
            type="button"
            class="move__icon tapc"
            aria-label="Back"
            onClick={onClose}
          >
            ‹
          </button>
          <span class="move__title">Move to another device</span>
          <button
            type="button"
            class="move__icon tapc"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div class="move__body">
          <p class="move__lead">
            Open <span class="mono">{location.host}</span>{" "}
            on your other device and point its camera here — or copy the link
            below.
          </p>
          <div class="move__qr">
            <QrCode value={url} />
            <div class="move__qr-logo">
              <Logo size={26} />
            </div>
          </div>
          <div class="move__link">
            <div class="move__url mono">{display}</div>
            <button type="button" class="move__copy tapc" onClick={copy}>
              <CopyIcon />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div class="move__safety">
            <ShieldIcon />
            <div>
              Anyone with this link can sign in as <b>{name}</b>{" "}
              — it doesn't expire, so keep it private.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
