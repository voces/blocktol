import { Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { formatPercentile } from "../../common/formatPercentile.ts";
import { percentileBand } from "../../common/percentileColor.ts";
import { api } from "../api.ts";
import { showBoard } from "../store/board.ts";
import {
  fetchProfile,
  patchProfile,
  profile as profileSignal,
} from "../store/profile.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useSettings } from "../hooks/useSettings.ts";
import {
  themes,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../common/settings.ts";
import { avatarColor, avatarInitial } from "../../common/avatar.ts";
import { getId } from "../util/id.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { GameStateContext } from "./Game/useGameState.ts";
import { Modal } from "./Modal.tsx";
import { MoveDevice } from "./MoveDevice.tsx";
import { Crown, Flag } from "./Notifications/icons.tsx";
import { pushPermission, requestPushPermission } from "../util/push.ts";
import type { NotificationPrefs } from "../../common/settings.ts";

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

// One notification preference row: an icon tile, its copy, and an on/off switch.
const NotifRow = (
  { icon, accent, title, sub, on, onChange }: {
    icon: h.JSX.Element;
    accent: string;
    title: string;
    sub: string;
    on: boolean;
    onChange: (next: boolean) => void;
  },
) => (
  <div class="notif-pref">
    <span class="notif-pref__tile" style={{ color: accent }} aria-hidden="true">
      {icon}
    </span>
    <div class="notif-pref__text">
      <div class="notif-pref__title">{title}</div>
      <div class="notif-pref__sub">{sub}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={title}
      class={"switch tapc" + (on ? " switch--on" : "")}
      onClick={() => onChange(!on)}
    >
      <span class="switch__knob" />
    </button>
  </div>
);

const ProfileDialog = (
  { onClose, onMove }: { onClose: () => void; onMove: () => void },
) => {
  const { attemptsRemaining, viewMaze } = useContext(GameStateContext);
  // Signal read: the dialog re-renders as the open-time refetch lands.
  const profile = profileSignal.value;
  const { settings, setSettings } = useSettings();
  // The zoom setting only matters on touch, so it's hidden on non-touch pointers
  // unless the user has moved it off the default (so a set value stays editable).
  const touch = useMediaQuery("(pointer: coarse)");
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Refresh on open so the (cached) figures are current; the dialog stays
  // populated from the cache in the meantime.
  useEffect(() => {
    fetchProfile();
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
        if (profile) patchProfile({ ...profile, name: r.name });
        setEditing(false);
      }
    }).catch(() => setSaving(false));
  };

  // Best build opens on the board (a static review), same route the today-result
  // uses: stage that day's board, then overlay the best maze. Only once the
  // daily's ranked attempts are spent (free play / replay is unlocked then).
  const bestIteration = profile?.bestBuildIteration ?? null;
  const canView = attemptsRemaining === 0 && bestIteration != null;
  const viewBest = () => {
    if (!canView) return;
    onClose();
    // Fetch the best maze and stage the day's board in parallel (two round
    // trips become one), overlaying once both land — skipped if a newer
    // navigation superseded the stage.
    Promise.all([
      showBoard(bestIteration!),
      api.best({ iteration: bestIteration! }),
    ]).then(([staged, best]) => {
      if (staged && !("error" in best)) viewMaze(best.maze);
    });
  };

  // Toggle a notification preference. Turning one ON also nudges the browser for
  // push permission (and subscribes) — silently a no-op if already granted or
  // unsupported; in-app delivery works regardless of the answer.
  const setNotif = (patch: Partial<NotificationPrefs>) => {
    setSettings({ notifications: { ...settings.notifications, ...patch } });
    const turnedOn = patch.lostTop === true || patch.dailyFinal === true;
    if (turnedOn && pushPermission() !== "granted") requestPushPermission();
  };

  const name = profile?.name || "Anonymous";
  const initial = avatarInitial(profile?.name);
  const color = avatarColor(getId());
  const joined = joinedLabel(profile?.joined ?? null);
  const median = profile?.medianPercentile;

  return (
    <Modal class="profile-sheet" onClose={onClose}>
      <button
        type="button"
        class="modal__icon modal__close-x profile-modal__close tapc"
        aria-label="Close profile"
        onClick={onClose}
      >
        ×
      </button>

      <div class="profile-head">
        {editing
          ? (
            // A full-width bar replaces the header while editing, so the input
            // has room instead of being crushed between the avatar and rating.
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
                // Read as a username field, not a name — no first-letter
                // capitalization (nudging folks toward handles), no
                // autocorrect/spellcheck underlining their handle.
                autocapitalize="none"
                autocorrect="off"
                autocomplete="off"
                spellcheck={false}
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
            <>
              <div
                class="profile-head__avatar"
                aria-hidden="true"
                style={{
                  background: color,
                  boxShadow: `0 8px 20px -8px ${color}`,
                }}
              >
                {initial}
              </div>
              <div class="profile-head__id">
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
            </>
          )}
      </div>

      <div class="profile-stats">
        <Stat value={profile ? String(profile.played) : "—"} label="Played" />
        <Stat
          value={profile ? String(profile.hundreds) : "—"}
          label="Records"
          color={profile && profile.hundreds > 0 ? "var(--peak)" : undefined}
        />
        <Stat
          value={typeof median === "number"
            ? `p${formatPercentile(median)}`
            : "—"}
          label="Median percentile"
          color={typeof median === "number"
            ? percentileBand(median)
            : undefined}
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

      <div class="pref">
        <div class="section-title">Notifications</div>
        <NotifRow
          icon={<Crown />}
          accent="var(--gold)"
          title="Lost the top spot"
          sub="Someone passes your #1"
          on={settings.notifications.lostTop}
          onChange={(v) => setNotif({ lostTop: v })}
        />
        <NotifRow
          icon={<Flag />}
          accent="var(--accent)"
          title="Daily finalized"
          sub="A day you played locks its ranks"
          on={settings.notifications.dailyFinal}
          onChange={(v) => setNotif({ dailyFinal: v })}
        />
      </div>

      <div class="pref">
        <div class="section-title">Preferences</div>

        <div class="pref__row">
          <div class="pref__label">Appearance</div>
          <div class="pref__seg" role="group" aria-label="Appearance">
            {themes.map((t) => (
              <button
                key={t}
                type="button"
                class={"pref__seg-btn tapc" +
                  (settings.theme === t ? " pref__seg-btn--active" : "")}
                aria-pressed={settings.theme === t}
                onClick={() => setSettings({ theme: t })}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {(touch || settings.zoom !== ZOOM_DEFAULT) && (
          <div class="pref__row pref__row--stack">
            <div class="pref__head">
              <div>
                <div class="pref__label">Zoom when placing</div>
                <div class="pref__sub">Magnifies the board on touch.</div>
              </div>
              <div class="pref__value mono">
                {settings.zoom <= ZOOM_MIN
                  ? "Off"
                  : `${settings.zoom.toFixed(1)}×`}
              </div>
            </div>
            <input
              class="pref__slider"
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.1}
              value={settings.zoom}
              aria-label="Zoom when placing"
              onInput={(e) =>
                setSettings({ zoom: Number(e.currentTarget.value) })}
            />
          </div>
        )}
      </div>

      <div class="pref">
        <div class="section-title">Account</div>
        <button
          type="button"
          class="profile-action profile-action--row tapc"
          onClick={onMove}
        >
          <LinkIcon />
          <div class="profile-action__text">
            <div class="profile-action__title">Move to another device</div>
            <div class="profile-action__sub">
              Scan a code or copy your login link
            </div>
          </div>
          <span class="profile-action__chev" aria-hidden="true">›</span>
        </button>
      </div>
    </Modal>
  );
};

export const Profile = () => {
  const { attemptsRemaining } = useContext(GameStateContext);
  const profile = profileSignal.value;
  const [open, setOpen] = useState(false);
  // The move sheet replaces the dialog rather than stacking over it: opening it
  // closes the dialog; its back button reopens the dialog, its close dismisses
  // to the board.
  const [moving, setMoving] = useState(false);

  // Hidden while a daily is in progress (mirrors the calendar button) — no
  // wandering off to the profile mid-run.
  if (attemptsRemaining !== 0) return null;

  const name = profile?.name || "Anonymous";

  // Once the (prefetched) profile is loaded, the button is the coloured letter
  // avatar; until then, the neutral person glyph.
  return (
    <>
      <button
        type="button"
        class={"profile tapc " +
          (profile ? "profile-avatar-btn" : "icon-button")}
        style={profile ? { background: avatarColor(getId()) } : undefined}
        onClick={() => setOpen(true)}
        // Warm the profile the moment intent shows — pointerenter covers mouse
        // hover and the first touch, onFocus covers keyboard. fetchProfile
        // coalesces/rate-limits, so repeated events don't spam requests.
        onPointerEnter={() => fetchProfile()}
        onFocus={() => fetchProfile()}
        title="Profile"
        aria-label="Open profile"
      >
        {profile
          ? (
            <span class="profile-avatar-btn__initial">
              {avatarInitial(profile.name)}
            </span>
          )
          : (
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
          )}
      </button>
      {open && (
        <ProfileDialog
          onClose={() => setOpen(false)}
          onMove={() => {
            setOpen(false);
            setMoving(true);
          }}
        />
      )}
      {moving && (
        <MoveDevice
          name={name}
          onBack={() => {
            setMoving(false);
            setOpen(true);
          }}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  );
};
