import type { PaymentId } from "@hookx/domain";
import type { ExceptionCode } from "./codes.js";

/**
 * Deduplication identity for one underlying condition.
 *
 * Stored webhook: exceptionCode + webhookEventId + paymentId.
 * Pre-persist rejection (no webhook row): exceptionCode + correlationId.
 *
 * Retries of the same stored event reuse webhookEventId, so they do not mint
 * unlimited rows for the same code. Unrelated incidents keep distinct keys.
 */
export function exceptionIdentity(input: {
  readonly exceptionCode: ExceptionCode;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly correlationId: string;
}): string {
  const webhook = input.webhookEventId ?? "";
  const payment = input.paymentId ?? "";
  const correlationScope = webhook.length > 0 ? "" : input.correlationId;
  return `${input.exceptionCode}|${webhook}|${payment}|${correlationScope}`;
}
