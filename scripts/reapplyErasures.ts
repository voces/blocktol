// Re-apply "Delete my data" after restoring a backup.
//
// A backup taken before a player erased their data still holds them under their
// old id, so restoring it brings them back. The erasure itself left no row (the
// id was rotated away), but every request is logged with the hash of the caller's
// id (`userHash`, util/hashUserId.ts), and logs outlive every backup (30 days in
// VictoriaLogs vs at most ~28 for a backup — see deploy/README.md "Backups"). So
// the successful `deleteAccount` calls since the backup, by hash, are exactly
// the players to erase again: this hashes every id in the restored `user` table
// and anonymizes the matches with the same `anonymizeUser` the endpoint runs.
//
// Feed it the hashes, one per line, from the box (VictoriaLogs is localhost-only):
//
//   curl -s localhost:9428/select/logsql/query --data-urlencode \
//     'query=_time:30d "request finish" "deleteAccount" | unpack_logfmt
//       | filter route:="/api/deleteAccount" status:=200 | fields userHash' \
//     | jq -r .userHash | sort -u > erased.txt
//
//   APP_ENV=prod SQL_PASSWORD=... \
//     deno run --allow-net --allow-env=APP_ENV,SQL_PASSWORD,SQL_PROXY_URL \
//     scripts/reapplyErasures.ts < erased.txt
//
// Dry-run by default: reports how many restored players match. Pass `--apply` to
// anonymize them. Safe to re-run: an anonymized id no longer hashes to anything
// in the list.

import { anonymizeUser } from "../server/db/deleteAccount.ts";
import { sql } from "../server/db/query.ts";
import { hashUserId } from "../server/util/hashUserId.ts";

const apply = Deno.args.includes("--apply");

const input = new TextDecoder().decode(
  await new Response(Deno.stdin.readable).arrayBuffer(),
);
const erased = new Set(
  input.split(/\s+/).filter((h) => /^[0-9a-f]{16}$/.test(h)),
);
if (erased.size === 0) {
  console.error("no hashes on stdin (one 16-hex-char userHash per line)");
  Deno.exit(1);
}

const users = await sql<{ id: string }[]>`SELECT id FROM user`;
const matches: string[] = [];
for (const { id } of users) {
  if (erased.has(await hashUserId(id))) matches.push(id);
}

console.log(
  `${erased.size} erased hashes, ${users.length} users, ${matches.length} to re-erase`,
);
if (!apply) {
  if (matches.length) console.log("dry run — pass --apply to anonymize them");
  Deno.exit(0);
}
for (const id of matches) await anonymizeUser(id, crypto.randomUUID());
console.log(`anonymized ${matches.length}`);
