import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { Router } from "./Router.ts";
import { NotFoundError, UserError } from "./UserError.ts";
import { staticServe } from "../middleware/staticServe.ts";

const get = (path: string) => new Request("http://x.test" + path);

test("Router: a UserError is a 400, a NotFoundError a 404", async () => {
  const r = new Router();
  r.get("/bad", () => {
    throw new UserError("bad");
  });
  r.get("/missing", () => {
    throw new NotFoundError("Iteration 9 does not exist");
  });
  assertEquals((await r.route(get("/bad"))).status, 400);
  const res = await r.route(get("/missing"));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.message, "Iteration 9 does not exist");
});

test("staticServe: a malformed percent-escape is a 400", async () => {
  const r = new Router();
  r.use(staticServe("public"));
  assertEquals((await r.route(get("/%E0%A4%A"))).status, 400);
});
