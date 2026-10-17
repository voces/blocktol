// Player-chosen text (display names, and the raw auth id an admin alert quotes)
// interpolated into a Discord message is markdown the PLAYER wrote: a name like
// `[Free Nitro](https://x.co)` renders as a masked link in the results channel,
// `# BIG` as a heading, a newline breaks out of the line it was set in. Every
// such value goes through one of these before it reaches Discord.

// Discord's markdown metacharacters (emphasis, strike, spoiler, code, quote,
// masked links, headings, list/subtext markers) plus `<` (the `<@id>` /
// `<#channel>` / `<t:…>` tag syntax). A backslash renders each literally.
const MARKDOWN = /[\\*_~`|>[\]()#\-<]/g;

// C0/C1 controls and line/paragraph separators: a name must stay on its line.
// deno-lint-ignore no-control-regex
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

// The same text set as inline code (`…`). Nothing renders inside a code span
// and a backslash is literal there, so the only escape is not to close it early:
// backticks are dropped, and the span can't spill past its line.
export const discordCode = (text: string): string =>
  "`" + (text.replace(CONTROL, " ").replace(/`/g, "") || " ") + "`";
