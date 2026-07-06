import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { formatPercentile } from "../../common/formatPercentile.ts";
import { api } from "../api.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { getId } from "../util/id.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { GameStateContext } from "./Game/useGameState.ts";

const loginLink = () => new URL(`/login/${getId()}`, location.origin).href;

const joinedLabel = (joined: number | null) =>
  joined == null ? null : new Date(joined).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

const EditIcon = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M9.5 2.5l2 2L5 11l-2.5.5L3 9z"
      fill="none"
      stroke="currentColor"
      stroke-width={1.3}
      stroke-linejoin="round"
    />
  </svg>
);

const LinkIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width={1.5}>
      <rect x={5.5} y={1.5} width={9} height={9} rx={2} />
      <path
        d="M10.5 12.5v1a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 3 5.5h1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </svg>
);

const Stat = (
  { value, label, color }: {
    value: string;
    label: string;
    color?: string;
  },
) => (
  <div class="profile-stat">
    <div class="profile-stat__value mono" style={color ? { color } : undefined}>
      {value}
    </div>
    <div class="profile-stat__label">{label}</div>
  </div>
);

const ProfileDialog = ({ onClose }: { onClose: () => void }) => {
  const mobile = useMediaQuery("(max-width: 1199.98px)");
  const { attemptsRemaining } = useContext(GameStateContext);
  const { profile, refetch, patch } = useProfile();
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef(-1);

  // Refresh on open so the (cached) figures are current; the dialog stays
  // populated from the cache in the meantime.
  useEffect(() => {
    refetch();
    return () => clearTimeout(copiedTimeout.current);
  }, []);

  const startEdit = () => {
    setNameInput(profile?.name ?? "");
    setEditing(true);
  };

  const save = () => {
    const name = nameInput.trim();
    if (!name || saving) return;
    setSaving(true);
    api.rename({ name }).then((r) => {
      setSaving(false);
      if (r && !("error" in r)) {
        if (profile) patch({ ...profile, name: r.name });
        setEditing(false);
      }
    }).catch(() => setSaving(false));
  };

  const copyLink = () => {
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([loginLink()], { type: "text/plain" }),
      }),
    ]);
    setCopied(true);
    clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 1500);
  };

  // Best build opens on the board (a static review), same route the today-result
  // uses: stage that day's board, then overlay the best maze. Only once the
  // daily's ranked attempts are spent (free play / replay is unlocked then).
  const bestIteration = profile?.bestBuildIteration ?? null;
  const canView = attemptsRemaining === 0 && bestIteration != null;
  const viewBest = () => {
    if (!canView) return;
    onClose();
    api.getBoard({ iteration: bestIteration!, timeZone: getTimeZone() })
      .then(() => api.best({ iteration: bestIteration! }));
  };

  const name = profile?.name || "Anonymous";
  const initial = (profile?.name ?? "").trim().charAt(0).toUpperCase() || "?";
  const joined = joinedLabel(profile?.joined ?? null);
  const median = profile?.medianPercentile;

  return (
    <div
      class={"profile-modal" + (mobile ? "" : " profile-modal--desktop")}
      onClick={onClose}
    >
      <div class="profile-modal__sheet" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          class="profile-modal__close tapc"
          aria-label="Close profile"
          onClick={onClose}
        >
          ×
        </button>

        <div class="profile-head">
          <div class="profile-head__avatar" aria-hidden="true">{initial}</div>
          <div class="profile-head__id">
            {editing
              ? (
                <form
                  class="profile-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <input
                    class="profile-rename__input"
                    value={nameInput}
                    maxLength={32}
                    autoFocus
                    onInput={(e) => setNameInput(e.currentTarget.value)}
                  />
                  <button
                    type="submit"
                    class="profile-rename__save tapc"
                    disabled={saving || !nameInput.trim()}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="profile-rename__cancel tapc"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </form>
              )
              : (
                <div class="profile-head__name-row">
                  <span class="profile-head__name">{name}</span>
                  <button
                    type="button"
                    class="profile-head__edit tapc"
                    aria-label="Edit name"
                    onClick={startEdit}
                  >
                    <EditIcon />
                  </button>
                </div>
              )}
            {joined && (
              <div class="profile-head__joined mono">joined {joined}</div>
            )}
          </div>
          <div class="profile-head__rating">
            <div class="profile-head__rating-value mono">
              {profile ? Math.round(profile.rating) : "—"}
            </div>
            <div class="profile-head__rating-label">Rating</div>
          </div>
        </div>

        <div class="profile-stats">
          <Stat value={profile ? String(profile.played) : "—"} label="Played" />
          <Stat
            value={profile ? String(profile.hundreds) : "—"}
            label="100%s"
            color={profile && profile.hundreds > 0 ? "var(--peak)" : undefined}
          />
          <Stat
            value={typeof median === "number"
              ? `p${formatPercentile(median)}`
              : "—"}
            label="Median percentile"
          />
        </div>

        <button
          type="button"
          class={"profile-best" +
            (canView ? " profile-best--clickable tapc" : "")}
          onClick={canView ? viewBest : undefined}
          disabled={!canView}
        >
          <div class="profile-best__label">Best build</div>
          <div class="profile-best__value mono">
            {profile?.bestBuild != null ? `${profile.bestBuild}s` : "—"}
          </div>
        </button>

        <button
          type="button"
          class="profile-action tapc"
          onClick={copyLink}
        >
          <LinkIcon />
          {copied ? "Copied login link!" : "Copy login link"}
        </button>
      </div>
    </div>
  );
};

export const Profile = () => {
  const { attemptsRemaining } = useContext(GameStateContext);
  const [open, setOpen] = useState(false);

  // Hidden while a daily is in progress (mirrors the calendar button) — no
  // wandering off to the profile mid-run.
  if (attemptsRemaining !== 0) return null;

  return (
    <>
      <button
        type="button"
        class="profile icon-button tapc"
        onClick={() => setOpen(true)}
        title="Profile"
        aria-label="Open profile"
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
      </button>
      {open && <ProfileDialog onClose={() => setOpen(false)} />}
    </>
  );
};
