import { router } from "../router.ts";
import { Handler } from "../util/Router.ts";

export const loginLink: Handler<"id"> = (req, { id }) => {
  if (id.match(/^[a-z0-9\-]+$/)) {
    return router.route(new Request(new URL(req.url).origin, req));
  }
};
