// `deno task i18n:check` — the CI gate that makes "never deploy untranslated"
// structural, not a matter of discipline. Fails when, for any configured target
// locale, a key is MISSING, STALE (stored hash ≠ current hash of the English
// message), or ORPHANED (present in the target but gone from en.json), or when a
// translation fails validation (ICU parses, argument parity with the source,
// CLDR plural-category coverage). Pure and network-free — safe on every PR,
// including forks where no API key is exposed. The i18n:translate auto-fixer
// heals every failure this reports.

import {
  loadConfig,
  readJson,
  sha256,
  type SourceCatalog,
  type TargetCatalog,
  validateTranslation,
} from "./i18nLib.ts";
import { parseMessage } from "./i18nParse.ts";

const en = await readJson<SourceCatalog>("en.json");
const enKeys = Object.keys(en);
const { targets } = await loadConfig();

const errors: string[] = [];

// The source must itself be valid ICU (a bad en.json message would break every
// downstream translation).
for (const key of enKeys) {
  try {
    parseMessage(en[key].message);
  } catch (e) {
    errors.push(`en/${key}: ICU parse error: ${(e as Error).message}`);
  }
}

const hashes = new Map<string, string>();
for (const key of enKeys) hashes.set(key, await sha256(en[key].message));

for (const locale of targets) {
  let target: TargetCatalog;
  try {
    target = await readJson<TargetCatalog>(`${locale}.json`);
  } catch {
    errors.push(
      `${locale}: missing catalog (i18n/${locale}.json) — run i18n:translate`,
    );
    continue;
  }
  for (const key of enKeys) {
    const entry = target[key];
    if (!entry) {
      errors.push(`${locale}/${key}: missing translation`);
      continue;
    }
    if (entry.hash !== hashes.get(key)) {
      errors.push(`${locale}/${key}: stale (source changed since translation)`);
      continue;
    }
    errors.push(
      ...validateTranslation(locale, key, entry.message, en[key].message),
    );
  }
  for (const key of Object.keys(target)) {
    if (!(key in en)) {
      errors.push(`${locale}/${key}: orphaned (not in en.json)`);
    }
  }
}

if (errors.length) {
  console.error(`i18n:check failed (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
  Deno.exit(1);
}
console.log(
  `i18n:check ok — ${enKeys.length} keys × ${targets.length} target locale(s)`,
);
