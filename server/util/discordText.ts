// Player-chosen text (display names, the raw auth id an admin alert quotes) is
// markdown the PLAYER wrote: `[Free Nitro](https://x.co)` renders as a masked
// link, `# BIG` as a heading, a newline escapes its line. Every such value goes
// through one of these before it reaches Discord.

// Discord's markdown metacharacters plus `<` (the `<@id>` / `<#channel>` tag
// syntax). A backslash renders each literally.
const MARKDOWN = /[\\*_~`|>[\]()#\-<]/g;

// C0/C1 controls and line/paragraph separators: a name must stay on its line.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

// Discord auto-links any bare `scheme://…`, escaped or not. A zero-width space
// after the colon keeps the text readable while killing the link.
const SCHEME = /:\/\//g;

// Plain text, safe to drop anywhere in a message or embed description.
export const escapeDiscord = (text: string): string =>
  text
    .replace(CONTROL, " ")
    .replace(MARKDOWN, "\\$&")
    .replace(SCHEME, ":\u200b//");

// The same text as inline code. Nothing renders inside a code span and a
// backslash is literal there, so the only escape needed is not closing it:
// backticks are dropped.
export const discordCode = (text: string): string =>
  "`" + (text.replace(CONTROL, " ").replace(/`/g, "") || " ") + "`";
