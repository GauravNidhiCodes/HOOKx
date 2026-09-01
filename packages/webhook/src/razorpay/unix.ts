import { instant, type Instant } from "@hookx/domain";
import { WebhookError } from "../errors.js";

const MAX_UNIX_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);

/**
 * Razorpay `created_at` fields are unix seconds (integer).
 * Source: https://razorpay.com/docs/api/payments/entity/
 */
export function instantFromUnixSeconds(value: unknown): Instant {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_UNIX_SECONDS
  ) {
    throw new WebhookError(
      "INVALID_TIMESTAMP",
      "Event occurrence timestamp must be unix seconds",
    );
  }
  return instant(new Date(value * 1000).toISOString());
}
