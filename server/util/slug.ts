// A public profile slug: the opaque, non-secret identifier that appears in a
// shareable `/u/<slug>` URL, in standings, and in logs. It is deliberately NOT
// the user id — the raw id is the bearer credential (the authorization header
// and /login/:id links; see client/util/id.ts), so it must never be published.
// The slug carries no authority: holding it lets you *view* a public profile,
// nothing more.
//
// Crockford base32 (lower-case, no i/l/o/u) keeps it unambiguous to read aloud
// or type, and free of accidental words. 12 symbols × 5 bits = 60 bits of
// randomness — collision-free well past any realistic user count, and wide
// enough that the profile space isn't enumerable/scrapable the way a sequential
// id would be.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SLUG_LENGTH = 12;

// Matches exactly a well-formed slug. Shared with the API validator and the
// `/u/:slug` route so a malformed path is rejected before any lookup.
export const SLUG_RE = new RegExp(`^[${ALPHABET}]{${SLUG_LENGTH}}$`);

export const randomSlug = () => {
  // Each byte masked to its low 5 bits indexes the 32-symbol alphabet. 256 is
  // an exact multiple of 32, so the mapping is perfectly uniform — no modulo
  // bias.
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  let slug = "";
  for (const byte of bytes) slug += ALPHABET[byte & 31];
  return slug;
};
