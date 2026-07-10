import { ComponentChildren, h } from "preact";
import { useEffect, useState } from "preact/compat";
import { avatarColorFromHue, avatarInitial } from "../../common/avatar.ts";
import { formatSeconds } from "../../common/format.ts";
import { formatPercentile } from "../../common/formatPercentile.ts";
import { percentileBand } from "../../common/percentileColor.ts";
import { api, MessageMap } from "../api.ts";
import { Logo } from "./Logo.tsx";

type Profile = NonNullable<MessageMap["getPublicProfile"]["profile"]>;

const joinedLabel = (joined: number | null) =>
  joined == null ? null : new Date(joined).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

const Stat = (
  { value, label, color }: { value: string; label: string; color?: string },
) => (
  <div class="profile-stat">
    <div class="profile-stat__value mono" style={color ? { color } : undefined}>
      {value}
    </div>
    <div class="profile-stat__label">{label}</div>
  </div>
);

const Frame = ({ children }: { children: ComponentChildren }) => (
  <div class="pubprof">
    <a class="pubprof__brand tapc" href="/" aria-label="Blocktol home">
      <Logo size={24} />
      <span>Blocktol</span>
    </a>
    <div class="pubprof__card">{children}</div>
    <a class="pubprof__cta tapc" href="/">Play Blocktol →</a>
  </div>
);

export const PublicProfile = ({ slug }: { slug: string }) => {
  // undefined = loading, null = no such profile, else the profile.
  const [state, setState] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.getPublicProfile({ publicId: slug })
      .then((r) => live && setState(r && !("error" in r) ? r.profile : null))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [slug]);

  if (state === undefined) {
    return (
      <Frame>
        <div class="pubprof__spinner" aria-label="Loading" />
      </Frame>
    );
  }

  if (state === null) {
    return (
      <Frame>
        <div class="pubprof__empty">
          <div class="pubprof__empty-title">Profile not found</div>
          <div class="pubprof__empty-sub">
            This link doesn't point to a player.
          </div>
        </div>
      </Frame>
    );
  }

  const color = avatarColorFromHue(state.hue);
  const joined = joinedLabel(state.joined);
  const median = state.medianPercentile;

  return (
    <Frame>
      <div class="pubprof__head">
        <div
          class="profile-head__avatar"
          aria-hidden="true"
          style={{ background: color, boxShadow: `0 8px 20px -8px ${color}` }}
        >
          {avatarInitial(state.name)}
        </div>
        <div class="profile-head__id">
          <div class="profile-head__name">{state.name || "Anonymous"}</div>
          {joined && (
            <div class="profile-head__joined mono">joined {joined}</div>
          )}
        </div>
        <div class="profile-head__rating">
          <div class="profile-head__rating-value mono">
            {Math.round(state.rating)}
          </div>
          <div class="profile-head__rating-label">Rating</div>
        </div>
      </div>

      <div class="profile-stats">
        <Stat value={String(state.played)} label="Played" />
        <Stat
          value={String(state.hundreds)}
          label="Records"
          color={state.hundreds > 0 ? "var(--peak)" : undefined}
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

      <div class="profile-best">
        <div class="profile-best__label">Best build</div>
        <div class="profile-best__value mono">
          {state.bestBuild != null
            ? `${formatSeconds(state.bestBuild, { min: 0 })}s`
            : "—"}
        </div>
      </div>
    </Frame>
  );
};
