import { WebhookError } from "../errors.js";

/**
 * Razorpay `amount` is an integer in the smallest currency sub-unit.
 * Source: https://razorpay.com/docs/api/payments/entity/
 *
 * JSON numbers are accepted only when they are safe integers.
 * No floating-point arithmetic is performed on the amount.
 */
export function parseRazorpayAmountMinor(value: unknown): bigint {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new WebhookError(
      "INVALID_AMOUNT",
      "Amount must be a non-negative integer of minor units",
    );
  }
  return BigInt(value);
}
