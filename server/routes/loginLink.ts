import { router } from "../router.ts";
import type { Handler } from "../util/Router.ts";

// Legacy `/login/:id` and `/l/:id` (see router.ts): re-route as the origin root
// (the SPA shell) when the id is plausible; otherwise fall through.
export const loginLink: Handler<"id"> = (req, { id }) => {
  if (id.match(/^[a-z0-9\-]+$/)) {
    return router.route(new Request(new URL(req.url).origin, req));
  }
};
