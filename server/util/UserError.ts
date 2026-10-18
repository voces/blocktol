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

// A request for something that doesn't exist (an unknown iteration id). Like
// any UserError it is the caller's fault and not logged as an error, but
// Router.route answers 404 instead of 400.
export class NotFoundError extends UserError {}
