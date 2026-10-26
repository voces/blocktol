// Re-apply "Delete my data" after restoring a backup.
//
// A backup taken before a player erased their data still holds them under their
// old id, so restoring it brings them back. The erasure left no row (the id was
// rotated), but every request logs a hash of the caller's id (`userHash`,
// util/hashUserId.ts), and logs outlive every backup (30 days in VictoriaLogs
// vs at most ~28; see deploy/README.md "Backups"). The successful
// `deleteAccount` hashes since the backup are the players to erase again: this
// hashes every id in the restored `user` table and runs `anonymizeUser` on the
// matches.
//
// Feed it the hashes, one per line. Each erasure posts `erasure <hash>` to the
// admin Discord channel (routes/deleteAccount.ts), which survives losing the
// box; while the box is up, VictoriaLogs (localhost-only) has the same list:
//
//   curl -s localhost:9428/select/logsql/query --data-urlencode \
//     'query=_time:30d "request finish" "deleteAccount" | unpack_logfmt
//       | filter route:="/api/deleteAccount" status:=200 | fields userHash' \
//     | jq -r .userHash | sort -u > erased.txt
//
//   APP_ENV=prod SQL_PASSWORD=... \
//     node scripts/reapplyErasures.ts < erased.txt
//
// Dry-run by default: reports how many restored players match. `--apply`
// anonymizes them. Safe to re-run: an anonymized id matches no hash.

import process from "node:process";
import { text as readAll } from "node:stream/consumers";
import { anonymizeUser } from "../server/db/deleteAccount.ts";
import { sql } from "../server/db/query.ts";
import { hashUserId } from "../server/util/hashUserId.ts";

const apply = process.argv.slice(2).includes("--apply");

const input = await readAll(process.stdin);
const erased = new Set(
  input.split(/\s+/).filter((h) => /^[0-9a-f]{16}$/.test(h)),
);
if (erased.size === 0) {
  console.error("no hashes on stdin (one 16-hex-char userHash per line)");
  process.exit(1);
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
  process.exit(0);
}
for (const id of matches) await anonymizeUser(id, crypto.randomUUID());
console.log(`anonymized ${matches.length}`);
