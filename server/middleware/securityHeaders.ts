// Baseline security headers, stamped on EVERY response — applied in index.ts
// around router.route, rather than as a router middleware, because the router's
// own fallbacks (the unhandled-route 404, the 400/500 catch) return past the
// middleware chain.
//
//   - nosniff: never let a browser reinterpret a served file as script/HTML.
//   - no-referrer: a legacy `/l/<id>` sign-in link's path is the bearer
//     credential (see router.ts); with any referrer at all, the first outbound
//     request from that page (fonts, a Discord link) would carry it off-site.
//     Nothing here relies on receiving a Referer.
//   - DENY + frame-ancestors 'none': nothing frames the app, and a framed board
//     is a clickjacking surface for one-tap actions (merge, delete account).
//   - HSTS: production is TLS-only behind nginx; a browser ignores it over
//     plain http, so local dev is unaffected.
//
// The CSP is deliberately MINIMAL — only directives that cannot break a page:
// there is no <base>, no <object>/<embed>, and no framing. A full script/style/
// connect policy would need a browser pass over the app, the SW (its own CSP
// governs its font fetches), the debug pages (inline scripts), and the privacy
// page before it ships; until then, don't extend this blind.
const HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["x-frame-options", "DENY"],
  [
    "content-security-policy",
    "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  ],
  ["strict-transport-security", "max-age=31536000"],
];

const stamp = (res: Response) => {
  for (const [k, v] of HEADERS) res.headers.set(k, v);
  return res;
};

export const withSecurityHeaders = (res: Response): Response => {
  try {
    return stamp(res);
  } catch {
    // Immutable headers (e.g. a Response.redirect() or a passed-through fetch
    // response): re-wrap — same body stream, status, and headers, now mutable.
    // A network error (status 0) can't be re-wrapped and carries no page to
    // protect; it goes out as-is.
    try {
      return stamp(new Response(res.body, res));
    } catch {
      return res;
    }
  }
};
