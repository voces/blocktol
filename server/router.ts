import { beginLogger } from "./middleware/beginLogger.ts";
import { endLogger } from "./middleware/endLogger.ts";
import { serveApp, staticServe } from "./middleware/staticServe.ts";
import { extractUserId } from "./middleware/userid.ts";
import { api } from "./routes/api.ts";
import { loginLink } from "./routes/loginLink.ts";
import { privacyPage } from "./privacy/page.ts";
import { Router } from "./util/Router.ts";

export const router = new Router();

router.use(beginLogger);
router.get("/login/:id", loginLink);
// `/login/:id` and its short alias `/l/:id` are LEGACY, kept for links and QRs
// already in the wild. New links put the id in the fragment (`/#l=<id>`,
// `signInLink` in client/util/id.ts) so the credential never reaches the
// server. Our logs redact these paths (`redactPath` in beginLogger.ts), but
// Deno's OTel span and nginx's access log still see them.
router.get("/l/:id", loginLink);
router.use(extractUserId);
router.post("/api/:method", api);
// The `/YYYYMMDD` day permalink (notification deep-links) is client-routed:
// serve the SPA shell. Must precede staticServe.
router.get("/:date(\\d{8})", serveApp("public"));
// Rendered per reader language (privacy/page.ts), not served from public/.
router.get("/privacy.html", privacyPage);
router.use(staticServe("public"));
router.use(endLogger);
