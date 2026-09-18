import { assert, assertEquals } from "@std/assert";
import { DISCORD_INVITE } from "../../common/constants.ts";
import { locales } from "./catalog.generated.ts";
import {
  HISTORY_URL,
  pickLocale,
  privacyPage,
  renderPrivacyPage,
} from "./page.ts";

const available = ["en", "de", "pt-BR", "zh-Hans"] as const;

Deno.test("pickLocale: an explicit ?lang wins over the browser's", () => {
  assertEquals(pickLocale(available, "de", "zh-Hans,en;q=0.5"), "de");
  // An unsupported ?lang falls through to the header rather than to English.
  assertEquals(pickLocale(available, "ko", "pt-BR"), "pt-BR");
});

Deno.test("pickLocale: Accept-Language is taken in q order, prefix-matched", () => {
  assertEquals(pickLocale(available, null, "fr;q=0.9,de;q=0.95"), "de");
  // Ties keep the header's own order.
  assertEquals(pickLocale(available, null, "zh-Hans,de"), "zh-Hans");
  // A regional tag matches its language (pt-PT → the one Portuguese catalog).
  assertEquals(pickLocale(available, null, "pt-PT"), "pt-BR");
  assertEquals(pickLocale(available, null, "en-US,en;q=0.9"), "en");
});

Deno.test("pickLocale: wildcards, q=0, junk, and no match give undefined", () => {
  assertEquals(pickLocale(available, null, "*"), undefined);
  assertEquals(pickLocale(available, null, "de;q=0"), undefined);
  assertEquals(pickLocale(available, null, "not a tag!!, ;;"), undefined);
  assertEquals(pickLocale(available, null, null), undefined);
  assertEquals(pickLocale(available, "", ""), undefined);
});

const body = (html: string) => html.slice(html.indexOf("<body>"));

Deno.test("the English page carries its links and no translation notice", () => {
  const html = renderPrivacyPage("en");
  assert(html.includes('<html lang="en">'));
  assert(html.includes("<title>Privacy &amp; data — Blocktol</title>"));
  assert(!html.includes('class="note"'));
  // The change history, the contact routes, and the in-app actions.
  assert(html.includes(`href="${HISTORY_URL}"`));
  assert(html.includes('href="mailto:admin@blocktol.com"'));
  assert(html.includes(`href="https://discord.gg/${DISCORD_INVITE}"`));
  assert(html.includes('href="/?profile=account"'));
  assert(html.includes('href="/?profile=delete"'));
  // Rights cards are headed by the in-app buttons' own labels (app catalog).
  assert(html.includes("<h3>Export my data</h3>"));
  assert(html.includes("<h3>Delete my data</h3>"));
  assert(html.includes("<strong>Profile → Account</strong>"));
  // The date is rendered, not left as a placeholder.
  assert(html.includes("Last updated September 17, 2026"));
});

Deno.test("every catalog locale renders completely", () => {
  for (const locale of locales) {
    const html = renderPrivacyPage(locale);
    assert(html.includes(`<html lang="${locale}">`), locale);
    // Only a translation says it is one, and points back at the English.
    assertEquals(html.includes('class="note"'), locale !== "en", locale);
    // No ICU syntax survives into the text (the CSS above <body> has braces).
    assert(!/[{}]/.test(body(html)), `${locale}: unrendered placeholder`);
  }
});

Deno.test("the handler serves the negotiated language, keyed on the header", async () => {
  const res = privacyPage(
    new Request("http://x/privacy.html?lang=en", {
      headers: { "accept-language": "de" },
    }),
  );
  assertEquals(res.headers.get("content-language"), "en");
  assertEquals(res.headers.get("vary"), "accept-language");
  assert((await res.text()).includes('<html lang="en">'));
});
