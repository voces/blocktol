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

// A sign-in link opened on a device that already has a profile is a fork, not a
// sign-in (see getPendingLink). This gate resolves it before the app boots —
// ahead of onboarding, per the design. Outcomes:
//   • clean device (no local profile) → confirm the adopt (1d)
//   • this device nearly empty + a real link → adopt the link silently (2e)
//   • otherwise (incl. a tiny link over a real profile) → merge / switch / keep
//     (2a → 2b / 2c)
// The runs figure and the threshold both use non-void run count (moveInfo).

type Side =
  | {
    id: string;
    name: string | null;
    joined: number;
    rating: number;
    runs: number;
  }
  | null;

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

const runs = (n: number) => `${n} run${n === 1 ? "" : "s"}`;
const joinedLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric" });

// ── icons (small, inline; stroke follows currentColor) ──────────────────────
const svg = (children: h.JSX.Element, size = 20) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const MergeIcon = () =>
  svg(
    <g stroke="currentColor" stroke-width={1.5}>
      <circle cx={8} cy={10} r={4.5} />
      <circle cx={12} cy={10} r={4.5} opacity={0.7} />
    </g>,
    22,
  );
const SwitchIcon = () =>
  svg(
    <g
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7h10l-2.5-2.5M16 13H6l2.5 2.5" />
    </g>,
    22,
  );
const Chevron = () =>
  svg(
    <path
      d="M8 5l4 5-4 5"
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
    />,
    18,
  );
const Check = () =>
  svg(
    <path
      d="M5 10.5l3 3 7-7.5"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
    />,
    14,
  );
const ClockIcon = () =>
  svg(
    <g
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx={10} cy={10} r={7} />
      <path d="M10 6v4l2.5 2" />
    </g>,
  );
const StackIcon = () =>
  svg(
    <path
      d="M10 3l7 3.5-7 3.5-7-3.5L10 3zM3 10.5l7 3.5 7-3.5"
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
    />,
  );
const InfoIcon = () =>
  svg(
    <g stroke="currentColor" stroke-width={1.4} stroke-linecap="round">
      <circle cx={10} cy={10} r={7.2} />
      <path d="M10 9.2v4" />
      <circle cx={10} cy={6.6} r={0.6} fill="currentColor" />
    </g>,
    16,
  );
const WarnIcon = () =>
  svg(
    <g
      stroke="currentColor"
      stroke-width={1.4}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M10 2.5l8 14H2z" />
      <path d="M10 8v4" />
      <circle cx={10} cy={14.4} r={0.6} fill="currentColor" />
    </g>,
    18,
  );
const CopyIcon = () =>
  svg(
    <g
      stroke="currentColor"
      stroke-width={1.4}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x={7} y={7} width={9} height={9} rx={2} />
      <path d="M13 5.5V4.5A1.5 1.5 0 0 0 11.5 3H5A1.5 1.5 0 0 0 3.5 4.5V11a1.5 1.5 0 0 0 1.5 1.5h1" />
    </g>,
    15,
  );

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
  const [linkSaved, setLinkSaved] = useState(false);

  // Leave the app as the current id (merge-into-self, keep, or new game): strip
  // the link so a refresh won't re-open the gate, then hand back to the app.
  const proceed = () => {
    clearLinkFromUrl();
    onResolved();
  };
  // Adopt a new identity (switch, adopt-other, merge-into-other, clean confirm):
  // commit the id and reboot so avatar, caches, and run state all reset cleanly.
  // Adopting an account that already has runs skips onboarding — a returning
  // player on a new device shouldn't get the tutorial. `toast` (silent 2e only)
  // rides sessionStorage to the fresh boot, where the app shows it over the board.
  const reloadAs = (
    id: string,
    opts?: { adoptedRuns?: number; toast?: { title: string; sub: string } },
  ) => {
    if ((opts?.adoptedRuns ?? 0) > 0) {
      localStorage.setItem("hasCompletedOnboarding", "true");
    }
    if (opts?.toast) {
      sessionStorage.setItem("gateToast", JSON.stringify(opts.toast));
    }
    adoptId(id);
    clearLinkFromUrl();
    location.assign("/");
  };

  const doMerge = async (which: "self" | "other") => {
    setMode("working");
    await api.merge({ other: linkId, primary: which });
    if (which === "self") proceed();
    else reloadAs(linkId, { adoptedRuns: other?.runs ?? 0 });
  };

  useEffect(() => {
    let live = true;
    const ids = localId ? [localId, linkId] : [linkId];
    api.moveInfo({ ids }).then(async (res) => {
      if (!live) return;
      if ("error" in res) return proceed(); // can't decide → don't block the app
      const s = localId ? res[0] : null;
      const o = localId ? res[1] : res[0];
      setSelf(s);
      setOther(o);

      // The link id has no profile — nothing to become; adopt it fresh.
      if (!o) return reloadAs(linkId);

      const selfRuns = s?.runs ?? 0;
      const otherRuns = o.runs;

      // Clean device / no local data: confirm the adopt (1d).
      if (!localId || selfRuns === 0) return setMode("confirm");

      // Escape hatch, one direction only: this device has almost nothing and the
      // link is a real account → adopt the link silently (2e). The link is
      // plainly meant to be the primary here, and its identity wins. We do NOT do
      // the reverse (silently folding a tiny link into a real local profile):
      // opening a link implies it should likely be primary, so quietly demoting
      // it to a discarded secondary would surprise — show the fork instead.
      if (selfRuns < SILENT_RATIO * otherRuns) { // 2e
        setMode("working");
        await api.merge({ other: linkId, primary: "other" });
        return reloadAs(linkId, {
          adoptedRuns: o.runs,
          toast: {
            title: `Signed in as ${o.name ?? "your other profile"}`,
            sub: `${runs(selfRuns)} from this device came along.`,
          },
        });
      }

      // Otherwise the fork — including a tiny link over a real profile. Default
      // the primary to the larger side.
      setPrimaryIsSelf(selfRuns >= otherRuns);
      setMode("fork");
    }).catch(() => proceed());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = () => {
    navigator.clipboard?.writeText(
      new URL("/l/" + localId, location.origin).href,
    );
    setCopied(true);
    setLinkSaved(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Centered-logo screens (clean adopt, fork).
  const brandFrame = (children: h.JSX.Element) => (
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
  // Sub-page screens (pick, switch): a left-justified header bar with a back
  // button and title, no logo — the fork is where you came from.
  const sheetFrame = (title: string, children: h.JSX.Element) => (
    <div class="mg">
      <div class="mg-card">
        <div class="mg-header">
          <button
            type="button"
            class="mg-headback tapc"
            aria-label="Back"
            onClick={() => setMode("fork")}
          >
            ‹
          </button>
          <span class="mg-headtitle">{title}</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (mode === "loading" || mode === "working") {
    return brandFrame(<div class="mg-spinner" aria-label="Loading" />);
  }

  // 1d — clean adopt confirm.
  if (mode === "confirm" && other) {
    return brandFrame(
      <div class="mg-inner">
        <div class="mg-confirm">
          <div class="mg-confirm-label">Continue on this device as…</div>
          <div class="mg-profile--solo">
            <Avatar id={other.id} name={other.name} size={72} glow />
            <div class="mg-name mg-name--lg">{other.name ?? "Player"}</div>
            <div class="mg-sub mono">joined {joinedLabel(other.joined)}</div>
          </div>
          <div class="mg-actions mg-actions--inset">
            <button
              type="button"
              class="mg-btn mg-btn--primary tapc"
              onClick={() => reloadAs(linkId, { adoptedRuns: other.runs })}
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
        </div>
      </div>,
    );
  }

  // 2a — the fork.
  if (mode === "fork" && self && other) {
    const sub = (s: NonNullable<Side>) =>
      `joined ${joinedLabel(s.joined)} · ${runs(s.runs)}`;
    return brandFrame(
      <div class="mg-inner">
        <div class="mg-pair">
          <div class="mg-lbl">On this device</div>
          <div class="mg-row">
            <Avatar id={self.id} name={self.name} />
            <div class="mg-rowtext">
              <div class="mg-name">{self.name ?? "Player"}</div>
              <div class="mg-sub mono">{sub(self)}</div>
            </div>
          </div>
          <div class="mg-divider">
            <span>THE LINK SIGNS IN AS</span>
          </div>
          <div class="mg-row">
            <Avatar id={other.id} name={other.name} glow />
            <div class="mg-rowtext">
              <div class="mg-name">{other.name ?? "Player"}</div>
              <div class="mg-sub mono">{sub(other)}</div>
            </div>
          </div>
        </div>
        <div class="mg-actions">
          <button
            type="button"
            class="mg-opt mg-opt--merge tapc"
            onClick={() => setMode("pick")}
          >
            <span class="mg-opt-icon">
              <MergeIcon />
            </span>
            <span class="mg-opt-body">
              <span class="mg-opt-title">Merge the two</span>
              <span class="mg-opt-sub">
                Keep one profile with everything from both
              </span>
            </span>
            <span class="mg-opt-chev">
              <Chevron />
            </span>
          </button>
          <button
            type="button"
            class="mg-opt tapc"
            onClick={() => setMode("switch")}
          >
            <span class="mg-opt-icon">
              <SwitchIcon />
            </span>
            <span class="mg-opt-body">
              <span class="mg-opt-title">Switch to {other.name ?? "it"}</span>
              <span class="mg-opt-sub">
                Leave {self.name ?? "this profile"}; reachable only by its link
              </span>
            </span>
            <span class="mg-opt-chev">
              <Chevron />
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

  // 2b — pick the primary + what combines.
  if (mode === "pick" && self && other) {
    const moreSelf = self.runs >= other.runs;
    const pickRow = (isSelf: boolean) => {
      const s = isSelf ? self : other;
      const on = primaryIsSelf === isSelf;
      const hasMore = isSelf === moreSelf;
      return (
        <button
          type="button"
          class={"mg-pickrow tapc" + (on ? " mg-pickrow--on" : "")}
          onClick={() => setPrimaryIsSelf(isSelf)}
        >
          <Avatar id={s.id} name={s.name} size={42} />
          <div class="mg-rowtext">
            <div class="mg-pickname">
              <span class="mg-name">{s.name ?? "Player"}</span>
              {hasMore && <span class="mg-badge">MORE DATA</span>}
            </div>
            <div class="mg-sub mono">rating {s.rating} · {runs(s.runs)}</div>
          </div>
          <span
            class={"mg-radio" + (on ? " mg-radio--on" : "")}
            aria-hidden="true"
          >
            {on && <Check />}
          </span>
        </button>
      );
    };
    const primaryName = (primaryIsSelf ? self.name : other.name) ?? "profile";
    return sheetFrame(
      "Merge accounts",
      <div class="mg-body">
        <div class="mg-section-lbl">Keep as primary</div>
        <div class="mg-desc">
          The primary sets the name, colour and rating you keep going forward.
        </div>
        <div class="mg-picklist">
          {pickRow(true)}
          {pickRow(false)}
        </div>
        <div class="mg-section-lbl">What we'll combine</div>
        <div class="mg-combine">
          <div class="mg-combine-row">
            <span class="mg-combine-icon">
              <ClockIcon />
            </span>
            <div>
              <div class="mg-combine-title">Daily maze attempts</div>
              <div class="mg-combine-sub">
                For any day you played on both, we keep whichever attempt{" "}
                <b>came first</b>.
              </div>
            </div>
          </div>
          <div class="mg-combine-row">
            <span class="mg-combine-icon mg-combine-icon--ok">
              <StackIcon />
            </span>
            <div>
              <div class="mg-combine-title">Everything else</div>
              <div class="mg-combine-sub">
                Your other runs from both accounts all carry over.{" "}
                <span class="mono">
                  {self.runs} + {other.runs} becomes {self.runs + other.runs}
                </span>.
              </div>
            </div>
          </div>
        </div>
        <div class="mg-note">
          <InfoIcon />
          <span>
            The first attempt stands, so a merge can't cherry-pick a faster
            time.
          </span>
        </div>
        <button
          type="button"
          class="mg-btn mg-btn--primary tapc mg-body-btn"
          onClick={() => doMerge(primaryIsSelf ? "self" : "other")}
        >
          Merge into {primaryName}
        </button>
      </div>,
    );
  }

  // 2c — switch, gated behind saving the current profile's link.
  if (mode === "switch" && self && other) {
    const url = new URL("/l/" + localId, location.origin).href;
    return sheetFrame(
      `Switch to ${other.name ?? "it"}?`,
      <div class="mg-body">
        <div class="mg-switch-avatars">
          <div class="mg-switch-one">
            <Avatar id={self.id} name={self.name} size={56} />
            <div class="mg-switch-name">{self.name ?? "Player"}</div>
          </div>
          <span class="mg-switch-arrow" aria-hidden="true">→</span>
          <div class="mg-switch-one">
            <Avatar id={other.id} name={other.name} size={56} glow />
            <div class="mg-switch-name">{other.name ?? "Player"}</div>
          </div>
        </div>
        <div class="mg-warn">
          <span class="mg-warn-icon">
            <WarnIcon />
          </span>
          <div>
            This device will play as <b>{other.name ?? "the other profile"}</b>
            {" "}
            from now on. <b>{self.name ?? "This profile"}</b>{" "}
            won't be here anymore; its {runs(self.runs)}{" "}
            live only behind its login link.
          </div>
        </div>
        <div class="mg-section-lbl">
          Save {self.name ?? "your"}'s link first
        </div>
        <div class="mg-link">
          <div class="mg-url mono">{url.replace(/^https?:\/\//, "")}</div>
          <button type="button" class="mg-copy tapc" onClick={copyLink}>
            <CopyIcon />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div class="mg-caption">
          Anyone with this link can sign back in as{" "}
          {self.name ?? "this profile"} on any device.
        </div>
        <button
          type="button"
          class="mg-btn mg-btn--primary tapc mg-body-btn"
          disabled={!linkSaved}
          onClick={() => reloadAs(linkId, { adoptedRuns: other.runs })}
        >
          Switch to {other.name ?? "it"}
        </button>
        {!linkSaved && (
          <div class="mg-note-center">Copy the link to enable this</div>
        )}
      </div>,
    );
  }

  return brandFrame(<div class="mg-spinner" aria-label="Loading" />);
};
