import { assertEquals } from "@std/assert";
import { renderMessage, resolveCatalog, t } from "./i18n.ts";
import { notificationText } from "./notifications.ts";
import { parseMessage } from "../scripts/i18nParse.ts";

// An explicit locale is passed so assertions don't depend on the host default.

Deno.test("t renders English source copy with grouped numbers", () => {
  assertEquals(
    t("en-US", "notif.dailyFinal.placed", { rank: 55, players: 2363 }),
    "You finished #55 of 2,363",
  );
});

Deno.test("renderMessage groups numbers per locale", () => {
  // Number formatting is locale-aware independent of catalog contents.
  const nodes = parseMessage("{n}");
  assertEquals(renderMessage(nodes, "en-US", { n: 2363 }), "2,363");
  assertEquals(renderMessage(nodes, "de-DE", { n: 2363 }), "2.363");
});

Deno.test("notificationText round-trips a stored notification", () => {
  const { title, body } = notificationText({
    kind: "daily_final",
    day: [2026, 7, 6],
    data: {
      variant: "placed",
      rank: 55,
      players: 2363,
      yourTime: 30.3,
      dayBest: 41,
    },
  }, "en-US");
  assertEquals(title, "Jul 6 daily is final");
  assertEquals(body, "You finished #55 of 2,363");
});

Deno.test("plural selection and # use the locale", () => {
  const nodes = parseMessage(
    "{count, plural, one {# player} other {# players}}",
  );
  assertEquals(renderMessage(nodes, "en-US", { count: 1 }), "1 player");
  assertEquals(renderMessage(nodes, "en-US", { count: 2363 }), "2,363 players");
  // German plural category for 1 is `one`; other numbers group with a dot.
  assertEquals(renderMessage(nodes, "de-DE", { count: 1 }), "1 player");
  assertEquals(renderMessage(nodes, "de-DE", { count: 2363 }), "2.363 players");
});

Deno.test("explicit =N plural branches win over category", () => {
  const nodes = parseMessage(
    "{n, plural, =0 {nobody} one {# player} other {# players}}",
  );
  assertEquals(renderMessage(nodes, "en-US", { n: 0 }), "nobody");
  assertEquals(renderMessage(nodes, "en-US", { n: 1 }), "1 player");
});

Deno.test("select picks a branch, falling back to other", () => {
  const nodes = parseMessage(
    "{who, select, you {you lead} other {{who} leads}}",
  );
  assertEquals(renderMessage(nodes, "en-US", { who: "you" }), "you lead");
  assertEquals(renderMessage(nodes, "en-US", { who: "Ana" }), "Ana leads");
});

Deno.test("resolveCatalog best-fits to a supported locale", () => {
  assertEquals(resolveCatalog(undefined), "en");
  assertEquals(resolveCatalog("en-GB"), "en"); // prefix match
  assertEquals(resolveCatalog("xx"), "en"); // unknown language → fallback
  assertEquals(resolveCatalog("de-DE"), "de"); // exact-language best fit
});

Deno.test("a malformed locale falls back instead of throwing", () => {
  // A bad stored user.locale must never break push rendering.
  const out = t("not a locale!!", "notif.dailyFinal.placed", {
    rank: 1,
    players: 2,
  });
  assertEquals(out, "You finished #1 of 2");
});
