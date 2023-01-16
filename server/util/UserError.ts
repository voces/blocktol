export class UserError extends Error {
  message!: string;

  constructor(message: string) {
    super(message);
    Object.defineProperty(this, "message", {
      enumerable: true,
      value: message,
    });
  }
}
