import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { discordCode, escapeDiscord } from "./discordText.ts";

test("escapeDiscord leaves a plain name alone", () => {
  assertEquals(escapeDiscord("alice"), "alice");
  assertEquals(escapeDiscord("Ünïcødé 名前"), "Ünïcødé 名前");
});

test("escapeDiscord defuses a masked link", () => {
  assertEquals(
    escapeDiscord("[Free Nitro](https://x.co)"),
    "\\[Free Nitro\\]\\(https:\u200b//x.co\\)",
  );
});

test("escapeDiscord kills a bare auto-link", () => {
  assertEquals(escapeDiscord("http://evil.co"), "http:\u200b//evil.co");
});

test("escapeDiscord escapes every markdown metacharacter", () => {
  assertEquals(
    escapeDiscord("\\*_~`|>[]()#-<"),
    "\\\\\\*\\_\\~\\`\\|\\>\\[\\]\\(\\)\\#\\-\\<",
  );
  assertEquals(
    escapeDiscord("**bold** ||spoiler||"),
    "\\*\\*bold\\*\\* \\|\\|spoiler\\|\\|",
  );
  assertEquals(escapeDiscord("<@&123>"), "\\<@&123\\>");
});

test("escapeDiscord keeps a name on its line", () => {
  assertEquals(escapeDiscord("a\n# big\r\nb"), "a \\# big  b");
  assertEquals(escapeDiscord("a\u2028b"), "a b");
});

test("discordCode can't be broken out of", () => {
  assertEquals(discordCode("abc-123"), "`abc-123`");
  assertEquals(discordCode("x` **pwn** `"), "`x **pwn** `");
  assertEquals(discordCode("a\nb"), "`a b`");
  assertEquals(discordCode("```"), "` `");
});
