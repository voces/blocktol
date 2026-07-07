import { h } from "preact";
import { useEffect, useState } from "preact/compat";
import { api } from "../api.ts";
import { avatarColor, avatarInitial } from "../util/avatar.ts";
import {
  adoptId,
  clearLinkFromUrl,
  getCleanLink,
  getId,
  getPendingLink,
  startFreshId,
} from "../util/id.ts";
import { Logo } from "./Logo.tsx";
import { QrCode } from "./QrCode.tsx";

// A sign-in link opened on a device that already has a profile is a fork, not a
// sign-in (see getPendingLink). This gate resolves it before the app boots —
// ahead of onboarding, per the design. Outcomes:
//   • clean device (no local profile) → confirm the adopt (1d)
//   • one side has <5% of the other's runs → merge silently, no fork (2d / 2e)
//   • both sides substantial → offer merge / switch / keep (2a → 2b / 2c)
// The "games" figure and the threshold both use non-void run count (moveInfo).

type Side = { id: string; name: string | null; games: number } | null;

// Below this share of the larger side's runs, a profile is "almost nothing" and
// we merge it away silently instead of showing the fork.
const SILENT_RATIO = 0.05;

const Avatar = (
  { id, name, size = 46, glow }: {
    id: string;
    name: string | null;
    size?: number;
    glow?: boolean;
  },
) => (
  <div
    class="mg-avatar"
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.28),
      background: avatarColor(id),
      fontSize: Math.round(size * 0.45),
      boxShadow: glow ? `0 0 18px -4px ${avatarColor(id)}` : undefined,
    }}
  >
    {avatarInitial(name)}
  </div>
);

const games = (n: number) => `${n} game${n === 1 ? "" : "s"}`;

type Mode = "loading" | "working" | "confirm" | "fork" | "pick" | "switch";

export const MoveGate = ({ onResolved }: { onResolved: () => void }) => {
  // getPendingLink → a fork over an existing profile; getCleanLink → a link on a
  // fresh device (confirm-adopt). Exactly one is non-null when this renders.
  const pending = getPendingLink();
  const linkId = pending ?? getCleanLink()!;
  const localId = pending ? getId() : null;

  const [mode, setMode] = useState<Mode>("loading");
  const [self, setSelf] = useState<Side>(null);
  const [other, setOther] = useState<Side>(null);
  const [primaryIsSelf, setPrimaryIsSelf] = useState(true);
  const [copied, setCopied] = useState(false);

  // Leave the app as the current id (merge-into-self, keep, or new game): strip
  // the link so a refresh won't re-open the gate, then hand back to the app.
  const proceed = () => {
    clearLinkFromUrl();
    onResolved();
  };
  // Adopt a new identity (switch, adopt-other, merge-into-other, clean confirm):
  // commit the id and reboot so avatar, caches, and run state all reset cleanly.
  const reloadAs = (id: string) => {
    adoptId(id);
    clearLinkFromUrl();
    location.assign("/");
  };

  const doMerge = async (which: "self" | "other") => {
    setMode("working");
    await api.merge({ other: linkId, primary: which });
    if (which === "self") proceed();
    else reloadAs(linkId);
  };

  useEffect(() => {
    let live = true;
    const ids = localId ? [localId, linkId] : [linkId];
    api.moveInfo({ ids }).then((res) => {
      if (!live) return;
      if ("error" in res) return proceed(); // can't decide → don't block the app
      const s = localId ? res[0] : null;
      const o = localId ? res[1] : res[0];
      setSelf(s);
      setOther(o);

      // The link id has no profile — nothing to become; adopt it fresh.
      if (!o) return reloadAs(linkId);

      const selfGames = s?.games ?? 0;
      const otherGames = o.games;

      // Clean device / no local data: confirm the adopt (1d).
      if (!localId || selfGames === 0) return setMode("confirm");

      // Escape hatches: one side almost empty → silent merge, no fork.
      if (otherGames < SILENT_RATIO * selfGames) return doMerge("self"); // 2d
      if (selfGames < SILENT_RATIO * otherGames) return doMerge("other"); // 2e

      // Both substantial → the fork. Default the primary to the larger side.
      setPrimaryIsSelf(selfGames >= otherGames);
      setMode("fork");
    }).catch(() => proceed());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = () => {
    const url = new URL("/l/" + localId, location.origin).href;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const frame = (children: h.JSX.Element) => (
    <div class="mg">
      <div class="mg-card">
        <div class="mg-brand">
          <Logo size={22} />
          <span>Blocktol</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (mode === "loading" || mode === "working") {
    return frame(<div class="mg-spinner" aria-label="Loading" />);
  }

  // 1d — clean adopt confirm.
  if (mode === "confirm" && other) {
    return frame(
      <div class="mg-inner">
        <div class="mg-profile mg-profile--solo">
          <Avatar id={other.id} name={other.name} size={64} glow />
          <div class="mg-name mg-name--lg">{other.name ?? "Player"}</div>
          <div class="mg-sub mono">{games(other.games)}</div>
        </div>
        <div class="mg-actions">
          <button
            type="button"
            class="mg-btn mg-btn--primary tapc"
            onClick={() => reloadAs(linkId)}
          >
            Continue as {other.name ?? "this player"}
          </button>
          <button
            type="button"
            class="mg-btn mg-btn--ghost tapc"
            onClick={() => {
              startFreshId();
              proceed();
            }}
          >
            Not you? Start a new game
          </button>
        </div>
      </div>,
    );
  }

  // 2a — the fork.
  if (mode === "fork" && self && other) {
    return frame(
      <div class="mg-inner">
        <div class="mg-pair">
          <div class="mg-lbl">On this device</div>
          <div class="mg-row">
            <Avatar id={self.id} name={self.name} />
            <div class="mg-rowtext">
              <div class="mg-name">{self.name ?? "Player"}</div>
              <div class="mg-sub mono">{games(self.games)}</div>
            </div>
          </div>
          <div class="mg-divider">
            <span>THE LINK SIGNS IN AS</span>
          </div>
          <div class="mg-row">
            <Avatar id={other.id} name={other.name} glow />
            <div class="mg-rowtext">
              <div class="mg-name">{other.name ?? "Player"}</div>
              <div class="mg-sub mono">{games(other.games)}</div>
            </div>
          </div>
        </div>
        <div class="mg-actions">
          <button
            type="button"
            class="mg-opt mg-opt--merge tapc"
            onClick={() => setMode("pick")}
          >
            <span class="mg-opt-title">Merge the two</span>
            <span class="mg-opt-sub">
              Keep one profile with everything from both
            </span>
          </button>
          <button
            type="button"
            class="mg-opt tapc"
            onClick={() => setMode("switch")}
          >
            <span class="mg-opt-title">Switch to {other.name ?? "it"}</span>
            <span class="mg-opt-sub">
              Leave {self.name ?? "this profile"}; reachable only by its link
            </span>
          </button>
          <button
            type="button"
            class="mg-btn mg-btn--ghost tapc"
            onClick={proceed}
          >
            Keep playing as {self.name ?? "you"}
          </button>
        </div>
      </div>,
    );
  }

  // 2b — pick the primary.
  if (mode === "pick" && self && other) {
    const pick = (isSelf: boolean) => (
      <button
        type="button"
        class={"mg-pickrow tapc" +
          (primaryIsSelf === isSelf ? " mg-pickrow--on" : "")}
        onClick={() => setPrimaryIsSelf(isSelf)}
      >
        <Avatar
          id={isSelf ? self.id : other.id}
          name={isSelf ? self.name : other.name}
          size={40}
        />
        <div class="mg-rowtext">
          <div class="mg-name">
            {(isSelf ? self.name : other.name) ?? "Player"}
          </div>
          <div class="mg-sub mono">
            {games(isSelf ? self.games : other.games)}
          </div>
        </div>
        <span class="mg-radio" aria-hidden="true" />
      </button>
    );
    const primaryName = (primaryIsSelf ? self.name : other.name) ?? "profile";
    return frame(
      <div class="mg-inner">
        <button
          type="button"
          class="mg-back tapc"
          aria-label="Back"
          onClick={() => setMode("fork")}
        >
          ‹
        </button>
        <div class="mg-heading">Pick the primary</div>
        <div class="mg-sub mg-sub--block">
          The primary sets the name, colour and rating you keep going forward.
          Every game from both is kept.
        </div>
        <div class="mg-picklist">
          {pick(true)}
          {pick(false)}
        </div>
        <div class="mg-actions">
          <button
            type="button"
            class="mg-btn mg-btn--primary tapc"
            onClick={() => doMerge(primaryIsSelf ? "self" : "other")}
          >
            Merge into {primaryName}
          </button>
        </div>
      </div>,
    );
  }

  // 2c — switch, after saving the current profile's link.
  if (mode === "switch" && self && other) {
    const url = new URL("/l/" + localId, location.origin).href;
    return frame(
      <div class="mg-inner">
        <button
          type="button"
          class="mg-back tapc"
          aria-label="Back"
          onClick={() => setMode("fork")}
        >
          ‹
        </button>
        <div class="mg-heading">Save {self.name ?? "your"}'s link first</div>
        <div class="mg-sub mg-sub--block">
          Switching leaves {self.name ?? "this profile"}{" "}
          on no device. This link is the only way back to it — keep it somewhere
          safe.
        </div>
        <div class="mg-qr">
          <QrCode value={url} />
        </div>
        <div class="mg-link">
          <div class="mg-url mono">{url.replace(/^https?:\/\//, "")}</div>
          <button type="button" class="mg-copy tapc" onClick={copyLink}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div class="mg-actions">
          <button
            type="button"
            class="mg-btn mg-btn--primary tapc"
            onClick={() => reloadAs(linkId)}
          >
            Switch to {other.name ?? "it"}
          </button>
        </div>
      </div>,
    );
  }

  return frame(<div class="mg-spinner" aria-label="Loading" />);
};
