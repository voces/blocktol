import { is } from "../../../common/typeguards.ts";

export const isTouchSource = is.object({
  sourceCapabilities: is.object({ firesTouchEvents: is.const(true) }),
});
