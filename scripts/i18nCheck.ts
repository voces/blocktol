// `npm run i18n:check` — the CI gate against deploying untranslated copy.
// Fails when, for any configured target locale, a key is MISSING, STALE (stored
// hash ≠ hash of the current English message) or ORPHANED (gone from en.json),
// or a translation fails validation (ICU parses, argument parity with the
// source, CLDR plural-category coverage). Network-free, so safe on forks with
// no API key. i18n:translate heals every failure this reports.

import process from "node:process";
import {
  CATALOGS,
  loadConfig,
  readJson,
  sha256,
  type SourceCatalog,
  type TargetCatalog,
  validateTranslation,
} from "./i18nLib.ts";
import { parseMessage } from "./i18nParse.ts";

const { targets } = await loadConfig();

const errors: string[] = [];
let keyCount = 0;

// Errors name the catalog's directory (`privacy/de/privacy.intro`).
for (const { dir } of CATALOGS) {
  const en = await readJson<SourceCatalog>(`${dir}en.json`);
  const sources = Object.entries(en);
  keyCount += sources.length;

  // The source must itself be valid ICU.
  for (const [key, { message }] of sources) {
    try {
      parseMessage(message);
    } catch (e) {
      errors.push(`${dir}en/${key}: ICU parse error: ${(e as Error).message}`);
    }
  }

  const hashes = new Map<string, string>();
  for (const [key, { message }] of sources) {
    hashes.set(key, await sha256(message));
  }

  for (const locale of targets) {
    let target: TargetCatalog;
    try {
      target = await readJson<TargetCatalog>(`${dir}${locale}.json`);
    } catch {
      errors.push(
        `${dir}${locale}: missing catalog (i18n/${dir}${locale}.json) — run i18n:translate`,
      );
      continue;
    }
    for (const [key, source] of sources) {
      const entry = target[key];
      if (!entry) {
        errors.push(`${dir}${locale}/${key}: missing translation`);
        continue;
      }
      if (entry.hash !== hashes.get(key)) {
        errors.push(
          `${dir}${locale}/${key}: stale (source changed since translation)`,
        );
        continue;
      }
      // Validated under the bare locale (it drives the CLDR plural check); the
      // directory is prefixed afterwards.
      errors.push(
        ...validateTranslation(locale, key, entry.message, source.message)
          .map((e) => `${dir}${e}`),
      );
    }
    for (const key of Object.keys(target)) {
      if (!(key in en)) {
        errors.push(`${dir}${locale}/${key}: orphaned (not in en.json)`);
      }
    }
  }
}

if (errors.length) {
  console.error(`i18n:check failed (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(
  `i18n:check ok — ${keyCount} keys in ${CATALOGS.length} catalog(s) × ${targets.length} target locale(s)`,
);
