const utf8 = new TextEncoder();

// A stable, non-reversible tag for a user id — for logs and telemetry ONLY, never
// for anything that authorizes a request.
//
// The raw id in the `authorization` header IS the bearer credential (see
// client/util/id.ts): anyone who reads it can act as — or merge away — that user.
// So it must never land in a log line, error report, or span, all of which flow to
// stores (VictoriaLogs, VictoriaTraces) that are readable without that authority.
// This
// hashes it first: correlation survives (the same id always maps to the same tag,
// so one player's requests are still followable through the logs/trace) while the
// stored value is useless as a credential — SHA-256 over the id's ~64 bits of
// entropy has no feasible preimage, so the tag can't be turned back into the id.
//
// 16 hex chars (64 bits of the digest) stays collision-free across any realistic
// user count and keeps log lines compact. Uses Web Crypto (async) rather than
// node:crypto's synchronous `createHash`: importing `node:crypto` pulls in
// `@types/node`, whose global `setTimeout` returns `NodeJS.Timeout` and breaks the
// client's `setTimeout`→`number` typing under the shared `deno check`. Same engine
// as webpush.ts's `sha256hex`.
export const hashUserId = async (id: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", utf8.encode(id));
  let hex = "";
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 16);
};
