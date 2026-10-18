// The privacy page, rendered in the reader's language (GDPR Art. 12 asks for
// intelligible notices). Its copy is a catalog like the app's:
// i18n/privacy/en.json is the source, translated by the same pipeline and held
// to the same i18n:check gate, compiled to ./catalog.generated.ts. That module
// is server-only so the prose stays out of the client bundle.
//
// The page is plain HTML (no script). Links into the app
// (`/?profile=account|delete`, see client/store/notifNav.ts) carry the actions,
// so export, the typed DELETE confirm and the post-erasure reload live in one
// place.

import { DISCORD_INVITE } from "../../common/constants.ts";
import {
  endonym,
  formatNumber,
  type I18nParams,
  matchLocale,
  renderMessage,
  t as tApp,
} from "../../common/i18n.ts";
import {
  catalog,
  type Locale,
  locales,
  type MessageKey,
  type MessageParams,
} from "./catalog.generated.ts";

// When the English text last changed in substance. Bump it for an edit to
// i18n/privacy/en.json that changes what the page SAYS, not for a typo,
// rewording or translation. The history link beside it is the exact record.
export const UPDATED = "2026-10-18";

// The public commit history of the English source; the file IS the page's text,
// hence a catalog of its own rather than keys in i18n/en.json.
export const HISTORY_URL =
  "https://github.com/voces/blocktol/commits/prod/i18n/privacy/en.json";

const CONTACT_EMAIL = "admin@blocktol.com";
// A proper noun, left untranslated; the sentence around it is the catalog's.
const DISCORD_NAME = "Blocktol Discord";

// Pick the page's language: an explicit `?lang` first (the in-app link passes
// the player's chosen language), then Accept-Language in q order, matched as
// the app does (exact tag, then language prefix). Undefined when nothing
// matches; the caller falls back to English.
export const pickLocale = <L extends string>(
  available: readonly L[],
  lang: string | null,
  acceptLanguage: string | null,
): L | undefined => {
  const prefs = (acceptLanguage ?? "").split(",")
    .map((part, i) => {
      const [tag, ...attrs] = part.trim().split(";");
      const q = attrs.map((a) => a.trim()).find((a) => a.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter(({ tag, q }) => tag && tag !== "*" && q > 0)
    // Stable on ties: the header's own order breaks them.
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map(({ tag }) => tag);
  for (const tag of [lang, ...prefs]) {
    const hit = tag ? matchLocale(tag, available) : undefined;
    if (hit) return hit;
  }
  return undefined;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Markup the page builds itself (a link, an emphasis) to splice into a message
// arg. Inserted verbatim; every other string is escaped.
type Markup = { html: string };
const markup = (html: string): Markup => ({ html });

type HtmlParams<K extends MessageKey> = {
  [P in keyof MessageParams[K]]: MessageParams[K][P] | Markup;
};
type ParamsArg<K extends MessageKey> = keyof MessageParams[K] extends never ? []
  : [HtmlParams<K>];

// Render a privacy-catalog message as HTML, the server-side twin of the
// client's tJsx: one arg per wrapped span, so a translation can place the link
// where its grammar needs. A locale missing the key falls back to English.
const message = <K extends MessageKey>(
  locale: Locale,
  key: K,
  ...params: ParamsArg<K>
): string => {
  const values = (params[0] ?? {}) as Record<string, string | number | Markup>;
  let out = "";
  for (const node of catalog[locale][key] ?? catalog.en[key]) {
    if (typeof node === "string") {
      out += esc(node);
    } else if ("plural" in node || "select" in node) {
      // Resolves to plain text (its selector is a number or enum, never
      // markup): delegate and escape.
      out += esc(renderMessage([node], locale, values as I18nParams));
    } else if ("pound" in node) {
      // `#` only occurs inside a plural branch, handled above.
    } else {
      const v = values[node.arg];
      if (v == null) continue;
      out += typeof v === "object"
        ? v.html
        : esc(typeof v === "number" ? formatNumber(locale, v) : v);
    }
  }
  return out;
};

const link = (href: string, text: string, external = false) =>
  `<a href="${esc(href)}"${
    external ? ' target="_blank" rel="noopener noreferrer"' : ""
  }>${text}</a>`;

const STYLES = `
    :root {
      color-scheme: light dark;
      --bg: light-dark(#f7f7fb, #0c0c11);
      --surface: light-dark(#fff, #17171f);
      --border: light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.1));
      --text: light-dark(#16161c, #eceef3);
      --dim: light-dark(#3d3d48, #c9cad3);
      --mute: light-dark(#6a6a77, #8a8a97);
      --accent: light-dark(hsl(220, 72%, 46%), hsl(220, 70%, 62%));
      --font: "Space Grotesk", system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 400 16px/1.65 var(--font);
      -webkit-text-size-adjust: 100%;
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 48px 22px calc(64px + env(safe-area-inset-bottom, 0px));
    }
    h1 { font-size: 30px; line-height: 1.2; margin: 0 0 4px; }
    h2 { font-size: 19px; margin: 36px 0 10px; }
    h3 { font-size: 17px; margin: 0 0 6px; }
    p, dd { color: var(--dim); }
    a { color: var(--accent); }
    strong, dt { color: var(--text); font-weight: 600; }
    dl { margin: 0; }
    dt { margin-top: 14px; }
    dd { margin: 2px 0 0; }
    .updated { color: var(--mute); font-size: 13px; margin: 0 0 32px; }
    .updated a { color: inherit; }
    .note {
      margin: -16px 0 32px;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      font-size: 14px;
    }
    .card {
      margin: 18px 0;
      padding: 16px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
    }
    .card p { margin: 0 0 10px; }
    .action { font-weight: 500; text-decoration: none; }
    .back {
      display: inline-block;
      margin-bottom: 28px;
      color: var(--mute);
      text-decoration: none;
      font-size: 14px;
    }
    footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      color: var(--mute);
      font-size: 13px;
    }
    footer p { color: inherit; margin: 0 0 12px; }
    .langs { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; padding: 0; list-style: none; }
    .langs a { color: inherit; }
    .langs a[aria-current] { color: var(--text); font-weight: 600; text-decoration: none; }
`;

// Keys that take no arguments: the plain text a list item is made of.
type PlainKey = {
  [K in MessageKey]: keyof MessageParams[K] extends never ? K : never;
}[MessageKey];

export const renderPrivacyPage = (locale: Locale): string => {
  const m = <K extends MessageKey>(key: K, ...params: ParamsArg<K>) =>
    message(locale, key, ...params);
  // Labels naming in-app controls come from the APP catalog, so they match the
  // controls they point at.
  const ui = (
    key:
      | "profile.title"
      | "profile.account"
      | "profile.exportData"
      | "del.title",
  ) => esc(tApp(locale, key));
  // Decoration, kept out of the accessible name.
  const glyph = (g: string) => `<span aria-hidden="true">${g}</span>`;

  const updated = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${UPDATED}T00:00:00Z`));

  const note = locale === "en" ? "" : `
    <p class="note">${m("privacy.translated")} ${
    link("/privacy.html?lang=en", m("privacy.readEnglish"))
  }</p>`;

  const list = (items: [PlainKey, PlainKey][]) =>
    `<dl>${
      items.map(([term, detail]) => `
      <dt>${m(term)}</dt>
      <dd>${m(detail)}</dd>`).join("")
    }
    </dl>`;

  const stored = list([
    ["privacy.store.id.term", "privacy.store.id.detail"],
    ["privacy.store.name.term", "privacy.store.name.detail"],
    ["privacy.store.gameplay.term", "privacy.store.gameplay.detail"],
    ["privacy.store.prefs.term", "privacy.store.prefs.detail"],
    ["privacy.store.rating.term", "privacy.store.rating.detail"],
    ["privacy.store.locale.term", "privacy.store.locale.detail"],
    ["privacy.store.push.term", "privacy.store.push.detail"],
    ["privacy.store.diagnostics.term", "privacy.store.diagnostics.detail"],
    ["privacy.store.logs.term", "privacy.store.logs.detail"],
  ]);

  const others = list([
    ["privacy.others.push.term", "privacy.others.push.detail"],
    ["privacy.others.discord.term", "privacy.others.discord.detail"],
  ]);

  // Each right is a card that opens the app at it (notifNav's `?profile=`),
  // headed by the in-app button's label.
  const card = (heading: string, body: PlainKey, href: string) => `
    <section class="card">
      <h3>${heading}</h3>
      <p>${m(body)}</p>
      <a class="action" href="${href}">${m("privacy.rights.open")} ${
    glyph("→")
  }</a>
    </section>`;

  const rightsIntro = m("privacy.rights.intro", {
    place: markup(
      `<strong>${ui("profile.title")} → ${ui("profile.account")}</strong>`,
    ),
  });

  const contact = m("privacy.contact.body", {
    email: markup(link(`mailto:${CONTACT_EMAIL}`, esc(CONTACT_EMAIL))),
    discord: markup(
      link(`https://discord.gg/${DISCORD_INVITE}`, esc(DISCORD_NAME), true),
    ),
  });

  // Every translation, named in its own language, for a reader the browser
  // guessed wrong for.
  const languages = locales.length < 2 ? "" : `
      <nav aria-label="${m("privacy.languages")}">
        <ul class="langs">${
    locales.map((l) => `
          <li><a href="/privacy.html?lang=${l}" hreflang="${l}" lang="${l}"${
      l === locale ? ' aria-current="page"' : ""
    }>${esc(endonym(l))}</a></li>`).join("")
  }
        </ul>
      </nav>`;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${m("privacy.docTitle")}</title>
  <meta name="color-scheme" content="light dark" />
  <link rel="icon" href="/favicon.svg" />
  <link rel="stylesheet" href="/fonts/fonts.css" />
  <style>${STYLES}</style>
</head>
<body>
  <main>
    <a class="back" href="/">${glyph("‹")} ${m("privacy.back")}</a>
    <h1>${m("privacy.title")}</h1>
    <p class="updated">${m("privacy.updated", { date: updated })} · ${
    link(HISTORY_URL, m("privacy.history"), true)
  }</p>${note}
    <p>${m("privacy.intro")}</p>

    <h2>${m("privacy.who.heading")}</h2>
    <p>${m("privacy.who.body")}</p>

    <h2>${m("privacy.store.heading")}</h2>
    ${stored}

    <h2>${m("privacy.cookies.heading")}</h2>
    <p>${m("privacy.cookies.body")}</p>

    <h2>${m("privacy.basis.heading")}</h2>
    <p>${m("privacy.basis.body")}</p>

    <h2>${m("privacy.others.heading")}</h2>
    <p>${m("privacy.others.intro")}</p>
    ${others}
    <p>${m("privacy.others.never")}</p>

    <h2>${m("privacy.transfers.heading")}</h2>
    <p>${m("privacy.transfers.body")}</p>

    <h2>${m("privacy.rights.heading")}</h2>
    <p>${rightsIntro}</p>${
    card(
      ui("profile.exportData"),
      "privacy.rights.export.body",
      "/?profile=account",
    )
  }${card(ui("del.title"), "privacy.rights.delete.body", "/?profile=delete")}
    <p>${m("privacy.rights.more")}</p>

    <h2>${m("privacy.retention.heading")}</h2>
    <p>${m("privacy.retention.body")}</p>

    <h2>${m("privacy.children.heading")}</h2>
    <p>${m("privacy.children.body")}</p>

    <h2>${m("privacy.contact.heading")}</h2>
    <p>${m("privacy.contact.operator")}</p>
    <p>${contact}</p>

    <footer>
      <p>${m("privacy.footer")}</p>${languages}
    </footer>
  </main>
</body>
</html>
`;
};

// Rendered once per locale per isolate: the output depends on nothing else.
const pages = new Map<Locale, string>();

export const privacyPage = (req: Request): Response => {
  const url = new URL(req.url);
  const locale = pickLocale(
    locales,
    url.searchParams.get("lang"),
    req.headers.get("accept-language"),
  ) ?? "en";
  let html = pages.get(locale);
  if (!html) pages.set(locale, html = renderPrivacyPage(locale));
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-language": locale,
      // Without `?lang` the language comes from the header, so caches must key
      // on it.
      "vary": "accept-language",
      "cache-control": "no-cache",
    },
  });
};
