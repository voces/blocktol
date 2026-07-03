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
