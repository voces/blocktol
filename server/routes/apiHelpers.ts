import { ZodType } from "zod";
import { AuthError, getUserId } from "../middleware/userid.ts";

export const method = <Input, Authed extends boolean>(
  validation: ZodType<Input>,
  authed?: Authed,
) =>
<Output>(
  handler: (
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
    // deno-lint-ignore no-explicit-any
    if (!authed) return handler(input as any, request);
    const userId = getUserId(request);
    // deno-lint-ignore no-explicit-any
    if (userId instanceof Error) return { error: userId, status: 401 } as any;
    return handler({ ...input, userId }, request);
  },
});

export type MethodReturn<
  // deno-lint-ignore no-explicit-any
  M extends { handler: (...args: any) => unknown },
> = Awaited<ReturnType<M["handler"]>>;
