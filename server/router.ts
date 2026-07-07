import { beginLogger } from "./middleware/beginLogger.ts";
import { endLogger } from "./middleware/endLogger.ts";
import { staticServe } from "./middleware/staticServe.ts";
import { extractUserId } from "./middleware/userid.ts";
import { api } from "./routes/api.ts";
import { loginLink } from "./routes/loginLink.ts";
import { Router } from "./util/Router.ts";

export const router = new Router();

router.use(beginLogger);
router.get("/login/:id", loginLink);
// `/l/:id` is the short alias used by the move-to-device QR / link.
router.get("/l/:id", loginLink);
router.use(extractUserId);
router.post("/api/:method", api);
router.use(staticServe("public"));
router.use(endLogger);
