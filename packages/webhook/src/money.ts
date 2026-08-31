import { WebhookError } from "./errors.js";

const MINOR_UNITS = /^(0|[1-9][0-9]*)$/;

export function parseAmountMinorString(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new WebhookError(
      "INVALID_AMOUNT",
      "Amount must be a decimal string of integer minor units",
    );
  }
  if (!MINOR_UNITS.test(value)) {
    throw new WebhookError(
      "INVALID_AMOUNT",
      "Amount must be a non-negative integer decimal string",
    );
  }
  return BigInt(value);
}
