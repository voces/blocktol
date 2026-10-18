// Baseline security headers for EVERY response. Applied in index.ts around
// router.route, not as router middleware, because the router's own fallbacks
// (the 404, the 400/500 catch) return past the middleware chain.
//
//   - nosniff: no reinterpreting a served file as script/HTML.
//   - no-referrer: a legacy `/l/<id>` link's path is the bearer credential
//     (router.ts); any referrer would carry it off-site on the first outbound
//     request. Nothing here relies on a Referer.
//   - DENY + frame-ancestors 'none': a framed board is a clickjacking surface
//     for one-tap actions (merge, delete account).
//   - HSTS: production is TLS-only behind nginx; browsers ignore it over http,
//     so local dev is unaffected.
//
// The CSP is MINIMAL on purpose: only directives that cannot break a page (no
// <base>, <object>/<embed> or framing). A full script/style/connect policy
// needs a browser pass over the app, the SW (its own CSP governs its font
// fetches), the debug pages (inline scripts) and the privacy page first.
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
    // Immutable headers (e.g. Response.redirect()): re-wrap with the same body,
    // status and headers. A network error (status 0) can't be re-wrapped and
    // carries no page to protect; it goes out as-is.
    try {
      return stamp(new Response(res.body, res));
    } catch {
      return res;
    }
  }
};
