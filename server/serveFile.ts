import { env } from "./util/env.ts";

const paths = {
  "/": "/index.html",
  "/js/index.js": "/js/index.js",
};

const files: typeof paths = { ...paths };

const isValid = (path: string): path is keyof typeof paths => path in paths;

export const serveFile = async (req: Request) => {
  const { pathname: path } = new URL(req.url);
  if (!isValid(path)) {
    return new Response(undefined, {
      status: 302,
      headers: { "Location": "/" },
    });
  }

  if (files[path] === paths[path] || env === "local") {
    files[path] = await Deno.readTextFile(`public${paths[path]}`);
  }

  return new Response(files[path], {
    headers: {
      "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html",
    },
  });
};
