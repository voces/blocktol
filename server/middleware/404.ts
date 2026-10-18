// Unhandled routes redirect to the origin root; a response already produced is
// passed through.
export const middleware404 = (req: Request, _: unknown, resp?: Response) =>
  resp ??
    new Response(null, {
      status: 302,
      headers: { Location: new URL(req.url).origin },
    });
