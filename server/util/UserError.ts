export class UserError extends Error {
  override message!: string;

  constructor(message: string) {
    super(message);
    Object.defineProperty(this, "message", {
      enumerable: true,
      value: message,
    });
  }
}

// A request for something that doesn't exist (an unknown iteration id): the
// caller's fault, like any UserError, but answered 404 rather than 400 (see
// Router.route's catch) — and, like any UserError, never logged as a server
// error.
export class NotFoundError extends UserError {}
