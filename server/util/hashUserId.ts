const utf8 = new TextEncoder();

// A stable, non-reversible tag for a user id, for logs and telemetry ONLY,
// never for authorizing anything.
//
// The raw id in the `authorization` header IS the bearer credential (see
// client/util/id.ts), and logs and spans flow to stores readable without it.
// So the id must never reach them raw: the same id always maps to the same tag
// (one player's requests stay followable), but the tag is useless as a
// credential.
//
// 16 hex chars (64 bits of the digest) is collision-free at any realistic user
// count.
export const hashUserId = async (id: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", utf8.encode(id));
  let hex = "";
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 16);
};
