import { trace } from "@opentelemetry/api";
import { errText, log } from "./logging.ts";
import { UserError } from "./UserError.ts";

type Method =
  | "delete"
  | "get"
  | "patch"
  | "post"
  | "put";

type PathParams<Path extends string> = Path extends
  `:${infer Param}/${infer Rest}` ? Param | PathParams<Rest>
  : Path extends `:${infer Param}` ? Param
  : Path extends `${infer _Prefix}:${infer Rest}` ? PathParams<`:${Rest}`>
  : never;

export type Handler<Params extends string = never> = (
  req: Request,
  params: { [param in Params]: string },
  previousResponse?: Response,
) => undefined | Response | Promise<undefined | Response>;

export type RouteHandler<Path extends string> = Handler<
  PathParams<Path>
>;

type AbstractRouter = Record<
  Method,
  <Path extends string>(
    pathname: Path,
    handler: RouteHandler<Path>,
  ) => void
>;

export class Router implements AbstractRouter {
  #routes: Record<
    Method,
    // deno-lint-ignore no-explicit-any
    { pattern: URLPattern; handler: RouteHandler<any> }[]
  > = {
    delete: [],
    get: [],
    patch: [],
    post: [],
    put: [],
  };

  use(handler: Handler): void;
  use<Path extends string>(pathname: Path, handler: RouteHandler<Path>): void;
  use(arg1: Handler | string, arg2?: Handler) {
    const handler = typeof arg1 === "function" ? arg1 : arg2!;
    const pathname = typeof arg1 === "string" ? arg1 : undefined;

    const pattern = new URLPattern({ pathname });

    this.#routes.delete.push({ pattern, handler });
    this.#routes.patch.push({ pattern, handler });
    this.#routes.get.push({ pattern, handler });
    this.#routes.post.push({ pattern, handler });
    this.#routes.put.push({ pattern, handler });
  }

  delete<Path extends string>(path: Path, handler: RouteHandler<Path>) {
    this.#routes.delete.push({
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  patch<Path extends string>(path: Path, handler: RouteHandler<Path>) {
    this.#routes.patch.push({
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  get<Path extends string>(path: Path, handler: RouteHandler<Path>) {
    this.#routes.get.push({
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  post<Path extends string>(path: Path, handler: RouteHandler<Path>) {
    this.#routes.post.push({
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  put<Path extends string>(path: Path, handler: RouteHandler<Path>) {
    this.#routes.put.push({
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  async route(request: Request): Promise<Response> {
    try {
      let resp: Response | undefined;

      const method = request.method.toLowerCase();
      if (!(method in this.#routes)) {
        return new Response(`Unsupported method: ${method}`, { status: 404 });
      }

      for (const { pattern, handler } of this.#routes[method as Method]) {
        const res = pattern.exec(request.url);
        if (!res) continue;

        resp = await handler(
          request,
          res.pathname.groups as { [key: string]: string },
          resp,
        );
      }

      if (resp) return resp;

      log.warn(request, "unhandled route", { url: request.url });
      return new Response("Not found", { status: 404 });
    } catch (err: unknown) {
      // A UserError is an expected 400 (bad input) — not something to page on,
      // so it's not logged at error level (endLogger still records the 400).
      if (typeof err === "object" && err instanceof UserError) {
        return Response.json({ error: err }, { status: 400 });
      }
      // log.error → VictoriaLogs (trace-correlated); recordException surfaces it
      // on the request span in VictoriaTraces, and the 500 response marks that
      // span errored. No-ops when OTel is off.
      log.error(request, "unhandled exception", { error: errText(err) });
      trace.getActiveSpan()?.recordException(
        err instanceof Error ? err : String(err),
      );
      return Response.json({ error: "unhandled exception" }, { status: 500 });
    }
  }
}
