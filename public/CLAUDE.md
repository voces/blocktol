# public/ — static assets

Loaded when working under `public/`. The root `CLAUDE.md` covers the whole repo:
what the game is, commands, the import rule, and the domain invariants every
area relies on.

`public/` holds the static shell (`index.html`, `sw.js`, `styles.css`,
`manifest.webmanifest`), the **self-hosted fonts** (`fonts/`: Space Grotesk +
JetBrains Mono woff2 subsets with a hash of their bytes in each name, served
immutable, and the `fonts.css` that declares them, a `?v` asset like
`styles.css` — so no request goes to Google), the icon/social assets
(`favicon.svg` plus PNGs regenerated from its mark: transparent
`icon-192.png`/`icon-512.png` for the manifest's `purpose:"any"`, but opaque
brand-bg `icon-maskable-512.png` and `apple-touch-icon.png` — maskable icons
must be full-bleed, and iOS composites the home-screen icon onto black so alpha
is pointless there — and the `og.png` share card), `robots.txt`, and two
standalone debug pages, `pathing.html` and `distributions.html`, that import the
separately-bundled `public/js/pathing.js` to visualize the pathfinder and the
daily-generation distributions. The shell **does** carry Open Graph / Twitter
tags (the Reddit/search share card points at `og.png`); chat-app unfurls are
suppressed instead at the crawler level — `robots.txt` disallows
`Discordbot`/`Slackbot`, which build embeds server-side and honor it — so a
shared link stays a plain link in chat while a Reddit post still gets a card.
Don't "fix" the missing-embed-in-Discord by removing the og tags; that's the
intended split.
