import { z } from "zod";
import { avatarHue } from "../../common/avatar.ts";
import { getUserIdByPublicId, getUserStats } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// A player's public profile, addressed by their non-secret slug (see
// server/util/slug.ts) — the data behind a shared `/u/<slug>` page.
//
// Unauthed by design: a public profile is public. The slug carries no
// authority, and the response is careful to leak nothing that does:
//   • the internal user id (the bearer credential) never ships — the avatar
//     colour rides as a HUE instead, exactly as standings do (see avatar.ts);
//   • `settings` (the owner's private prefs) is dropped.
// An unknown slug returns { profile: null } (a plain 200, not an error) so a
// mistyped link is an ordinary "not found" rather than a reported failure.
const body = z.object({ publicId: z.string().trim().min(1).max(16) });

export const getPublicProfile = method(body)(async ({ publicId }) => {
  const id = await getUserIdByPublicId(publicId);
  if (!id) return { profile: null };

  const s = await getUserStats(id);
  return {
    profile: {
      publicId,
      name: s.name,
      joined: s.joined,
      rating: s.rating,
      played: s.played,
      hundreds: s.hundreds,
      medianPercentile: s.medianPercentile,
      bestBuild: s.bestBuild,
      hue: avatarHue(id),
    },
  };
});
