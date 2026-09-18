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
// `/l/:id` is the short alias used by the move-to-device QR / link.
router.get("/l/:id", loginLink);
router.use(extractUserId);
router.post("/api/:method", api);
// The `/YYYYMMDD` day permalink (used by notification deep-links) is client
// routed: serve the SPA shell for it. Ahead of staticServe, which passes the
// response through.
router.get("/:date(\\d{8})", serveApp("public"));
// The privacy page is rendered in the reader's language (see privacy/page.ts),
// not served from public/ — at the url the static file always had.
router.get("/privacy.html", privacyPage);
router.use(staticServe("public"));
router.use(endLogger);
