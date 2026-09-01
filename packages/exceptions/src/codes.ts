export const EXCEPTION_CODES = [
  "INVALID_SIGNATURE",
  "MALFORMED_WEBHOOK",
  "UNSUPPORTED_EVENT",
  "CONFLICTING_EVENT",
  "INVALID_STATE_TRANSITION",
  "PROCESSING_FAILURE",
  "RETRY_EXHAUSTED",
  "OUT_OF_ORDER_EVENT",
  "MISSING_EVENT",
  "DUPLICATE_EVENT",
] as const;

export type ExceptionCode = (typeof EXCEPTION_CODES)[number];

export function isExceptionCode(value: string): value is ExceptionCode {
  return (EXCEPTION_CODES as readonly string[]).includes(value);
}
