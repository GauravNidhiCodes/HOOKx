export const WEBHOOK_ERROR_CODE = {
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  UNSUPPORTED_EVENT: "UNSUPPORTED_EVENT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  INVALID_CURRENCY: "INVALID_CURRENCY",
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
  MISSING_EXTERNAL_ID: "MISSING_EXTERNAL_ID",
  MISSING_PAYMENT_ID: "MISSING_PAYMENT_ID",
  UNSUPPORTED_PROVIDER: "UNSUPPORTED_PROVIDER",
} as const;

export type WebhookErrorCode =
  (typeof WEBHOOK_ERROR_CODE)[keyof typeof WEBHOOK_ERROR_CODE];

export class WebhookError extends Error {
  public readonly code: WebhookErrorCode;

  public constructor(code: WebhookErrorCode, message: string) {
    super(message);
    this.name = "WebhookError";
    this.code = code;
  }
}

export function isWebhookError(value: unknown): value is WebhookError {
  return value instanceof WebhookError;
}
