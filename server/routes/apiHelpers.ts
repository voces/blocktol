import { ZodType } from "zod";
import { AuthError, getUserId } from "../middleware/userid.ts";

// Builds one API handler entry `{ validation, handler }` for the `handlers`
// registry in api.ts: `method(zodSchema, authed?)(fn)`. `api` validates the
// body against `validation` before calling `handler`. With `authed` true,
// `handler` reads the caller's id from the request (`getUserId`) and passes
// `fn` the input plus `userId`; an unidentified caller gets `{ error, status:
// 401 }` and `fn` never runs. Without it, `fn` gets the validated input as is.
export const method = <Input, Authed extends boolean>(
  validation: ZodType<Input>,
  authed?: Authed,
) =>
<Output>(
  handler: (
    // `{}` is the identity for `&` when there is no `userId` to add.
    // deno-lint-ignore ban-types
    input: Input & (Authed extends true ? { userId: string } : {}),
    request: Request,
  ) => Output | Promise<Output>,
) => ({
  validation,
  handler: (
    input: Input,
    request: Request,
  ): Authed extends true
    ? Output | Promise<Output> | { error: AuthError; status: number }
    : Output | Promise<Output> => {
    // TS can't resolve the `Authed` conditional types inside the body.
    // deno-lint-ignore no-explicit-any
    if (!authed) return handler(input as any, request);
    const userId = getUserId(request);
    // deno-lint-ignore no-explicit-any
    if (userId instanceof Error) return { error: userId, status: 401 } as any;
    return handler({ ...input, userId }, request);
  },
});

export type MethodReturn<
  // Any handler signature must satisfy this constraint.
  // deno-lint-ignore no-explicit-any
  M extends { handler: (...args: any) => unknown },
> = Awaited<ReturnType<M["handler"]>>;
