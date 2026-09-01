import { WebhookError } from "../errors.js";
import { parseAmountMinorString } from "../money.js";

/**
 * Razorpay `amount` is an integer in the smallest currency sub-unit.
 * Source: https://razorpay.com/docs/api/payments/entity/
 *
 * JSON numbers are accepted only when they are safe integers.
 * Integer decimal strings are accepted so a quoted amount cannot become a float.
 * No floating-point arithmetic is performed. Currency exponent tables are not
 * applied; HOOKX stores the provider's minor units as `bigint`.
 */
export function parseRazorpayAmountMinor(value: unknown): bigint {
  if (typeof value === "string") {
    return parseAmountMinorString(value);
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  ) {
    return BigInt(value);
  }
  throw new WebhookError(
    "INVALID_AMOUNT",
    "Amount must be a non-negative integer of minor units",
  );
}
