import { Color } from "./Color.ts";
import { assert, assertEquals } from "std/testing/asserts.ts";
import { assertAbout } from "./asserts.ts";

Deno.test("read - write", () => {
  assertEquals(new Color("#abcdef").toString(), "rgb(171, 205, 239)");
  //   assertEquals(new Color("#e30318").toString(), "rgb(171, 205, 239)");
  assertEquals(new Color("#abcdef99").toString(), "rgba(171, 205, 239, 0.6)");
});

Deno.test("toHSLObject", async (t) => {
  await t.step("red", async (t) => {
    await t.step("base", () => {
      const { h, s, l } = new Color("#ff0000").toHSLObject();
      assertAbout(l, .5);
      assertAbout(s, 1);
      assertAbout(h, 0);
    });

    await t.step("light red", () => {
      const { h, s, l } = new Color("#ff1010").toHSLObject();
      assertAbout(l, .531, 3);
      assertAbout(s, 1);
      assertAbout(h, 0);
    });

    await t.step("dark red", () => {
      const { h, s, l } = new Color("#cc0000").toHSLObject();
      assertAbout(l, .4);
      assertAbout(s, 1);
      assertAbout(h, 0);
    });

    await t.step("muddy red", () => {
      const { h, s, l } = new Color("#cc1010").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 0);
    });

    await t.step("off red", () => {
      const { h, s, l } = new Color("#cc2010").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 5.1, 1);
    });
  });

  await t.step("green", async (t) => {
    await t.step("base", () => {
      const { h, s, l } = new Color("#00ff00").toHSLObject();
      assertAbout(l, .5);
      assertAbout(s, 1);
      assertAbout(h, 120);
    });

    await t.step("light green", () => {
      const { h, s, l } = new Color("#10ff10").toHSLObject();
      assertAbout(l, .531, 3);
      assertAbout(s, 1);
      assertAbout(h, 120);
    });

    await t.step("dark green", () => {
      const { h, s, l } = new Color("#00cc00").toHSLObject();
      assertAbout(l, .4);
      assertAbout(s, 1);
      assertAbout(h, 120);
    });

    await t.step("muddy green", () => {
      const { h, s, l } = new Color("#10cc10").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 120);
    });

    await t.step("off green", () => {
      const { h, s, l } = new Color("#20cc10").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 114.9, 1);
    });
  });

  await t.step("blue", async (t) => {
    await t.step("base", () => {
      const { h, s, l } = new Color("#0000ff").toHSLObject();
      assertAbout(l, .5);
      assertAbout(s, 1);
      assertAbout(h, 240);
    });

    await t.step("light blue", () => {
      const { h, s, l } = new Color("#1010ff").toHSLObject();
      assertAbout(l, .531, 3);
      assertAbout(s, 1);
      assertAbout(h, 240);
    });

    await t.step("dark blue", () => {
      const { h, s, l } = new Color("#0000cc").toHSLObject();
      assertAbout(l, .4);
      assertAbout(s, 1);
      assertAbout(h, 240);
    });

    await t.step("muddy blue", () => {
      const { h, s, l } = new Color("#1010cc").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 240);
    });

    await t.step("off blue", () => {
      const { h, s, l } = new Color("#2010cc").toHSLObject();
      assertAbout(l, .431, 3);
      assertAbout(s, .855, 3);
      assertAbout(h, 245.1, 1);
    });
  });
});
