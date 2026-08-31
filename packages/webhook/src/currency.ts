import { isoCurrencyCode, type IsoCurrencyCode } from "@hookx/domain";
import { WebhookError } from "./errors.js";

export function normalizeIsoCurrency(value: unknown): IsoCurrencyCode {
  if (typeof value !== "string") {
    throw new WebhookError(
      "INVALID_CURRENCY",
      "Currency must be an ISO 4217 alphabetic code",
    );
  }

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new WebhookError(
      "INVALID_CURRENCY",
      "Currency must be a 3-letter ISO 4217 alphabetic code",
    );
  }

  return isoCurrencyCode(normalized);
}
