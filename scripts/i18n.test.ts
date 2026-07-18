import { assert, assertEquals, assertRejects } from "@std/assert";
import { sha256, validateTranslation } from "./i18nLib.ts";
import {
  staleKeys,
  translateLocale,
  type Translator,
} from "./i18nTranslate.ts";

const en = {
  "a.greet": { message: "Hello {name}", description: "greeting" },
  "a.count": {
    message: "{n, plural, one {# maze} other {# mazes}}",
    description: "count",
  },
};

// A fake Translator — deterministic, no network. Returns whatever the map says.
const fake = (map: Record<string, string>): Translator => ({
  translate: (req) => {
    const out: Record<string, string> = {};
    for (const e of req.entries) out[e.key] = map[e.key] ?? e.message;
    return Promise.resolve(out);
  },
});

Deno.test("staleKeys: missing + source-changed", async () => {
  const existing = {
    "a.greet": {
      message: "Hola {name}",
      hash: await sha256(en["a.greet"].message),
    },
    "a.count": { message: "old", hash: "deadbeef" }, // hash mismatch → stale
  };
  assertEquals((await staleKeys(en, existing)).sort(), ["a.count"]);
});

Deno.test("translateLocale: fills stale, keeps fresh, returns null when up to date", async () => {
  const existing = {
    "a.greet": {
      message: "Hola {name}",
      hash: await sha256(en["a.greet"].message),
    },
  };
  // Spanish cardinal needs one/many/other (CLDR added `many` for Romance langs).
  const esCount =
    "{n, plural, one {# laberinto} many {# laberintos} other {# laberintos}}";
  const t = fake({ "a.count": esCount });
  const next = await translateLocale(t, "es", en, existing, {});
  assert(next);
  // Unchanged translation preserved verbatim.
  assertEquals(next["a.greet"].message, "Hola {name}");
  // New one spliced in with the source hash.
  assertEquals(next["a.count"].message, esCount);
  assertEquals(next["a.count"].hash, await sha256(en["a.count"].message));

  // Fully up to date → no work.
  assertEquals(await translateLocale(t, "es", en, next, {}), null);
});

Deno.test("translateLocale: prunes orphaned keys", async () => {
  const existing = {
    "a.greet": {
      message: "Hola {name}",
      hash: await sha256(en["a.greet"].message),
    },
    "a.count": {
      message: "{n, plural, one {# laberinto} other {# laberintos}}",
      hash: await sha256(en["a.count"].message),
    },
    "gone.key": { message: "huérfano", hash: "x" },
  };
  const next = await translateLocale(fake({}), "es", en, existing, {});
  assert(next);
  assert(!("gone.key" in next));
});

Deno.test("translateLocale: retries with feedback and succeeds", async () => {
  let calls = 0;
  const flaky: Translator = {
    translate: (req) => {
      calls++;
      const out: Record<string, string> = {};
      // First attempt drops {name}; the retry (which receives notes) fixes it.
      for (const e of req.entries) {
        out[e.key] = calls === 1 ? "Hola" : "Hola {name}";
      }
      return Promise.resolve(out);
    },
  };
  const next = await translateLocale(
    flaky,
    "es",
    { "a.greet": en["a.greet"] },
    {},
    {},
  );
  assert(next);
  assertEquals(next["a.greet"].message, "Hola {name}");
  assert(calls >= 2);
});

Deno.test("translateLocale: rejects a dropped placeholder", async () => {
  const bad = fake({ "a.greet": "Hola" }); // dropped {name}
  await assertRejects(
    () => translateLocale(bad, "es", en, {}, {}),
    Error,
    "missing args name",
  );
});

Deno.test("validateTranslation: plural category coverage", () => {
  // Polish needs one/few/many/other; supplying only one/other must fail.
  const errs = validateTranslation(
    "pl",
    "a.count",
    "{n, plural, one {# maze} other {# mazes}}",
    en["a.count"].message,
  );
  assert(errs.some((e) => e.includes("missing categor")));
});
