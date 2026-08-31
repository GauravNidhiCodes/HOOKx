export const FAILURE_CLASS = {
  RETRYABLE: "RETRYABLE",
  NON_RETRYABLE: "NON_RETRYABLE",
} as const;

export type FailureClass = (typeof FAILURE_CLASS)[keyof typeof FAILURE_CLASS];

export const FAILURE_CODE = {
  TEMPORARY_UNAVAILABLE: "TEMPORARY_UNAVAILABLE",
  TEMPORARY_DATABASE_FAILURE: "TEMPORARY_DATABASE_FAILURE",
  TRANSIENT_INTERNAL_ERROR: "TRANSIENT_INTERNAL_ERROR",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  MALFORMED_PAYLOAD: "MALFORMED_PAYLOAD",
  INVALID_NORMALIZED_EVENT: "INVALID_NORMALIZED_EVENT",
  UNSUPPORTED_EVENT: "UNSUPPORTED_EVENT",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  PERMANENT_CONFLICT: "PERMANENT_CONFLICT",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
} as const;

export type FailureCode = (typeof FAILURE_CODE)[keyof typeof FAILURE_CODE];

const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  FAILURE_CODE.INVALID_SIGNATURE,
  FAILURE_CODE.MALFORMED_PAYLOAD,
  FAILURE_CODE.INVALID_NORMALIZED_EVENT,
  FAILURE_CODE.UNSUPPORTED_EVENT,
  FAILURE_CODE.INVALID_TRANSITION,
  FAILURE_CODE.PERMANENT_CONFLICT,
  FAILURE_CODE.INVALID_PAYLOAD,
  "MISSING_EXTERNAL_ID",
  "MISSING_PAYMENT_ID",
  "INVALID_AMOUNT",
  "INVALID_CURRENCY",
  "INVALID_TIMESTAMP",
  "UNSUPPORTED_PROVIDER",
  "EXPIRED_SIGNATURE",
  "MISSING_SIGNATURE",
  "MALFORMED_SIGNATURE",
  "EVENT_NOT_FOUND",
  "INVALID_ROW",
  "INCONSISTENT_IDENTITY",
  "UNSAFE_DATABASE_NAME",
  "MISSING_DATABASE_URL",
  "PAYMENT_ID_MISMATCH",
  "IMPOSSIBLE_AFTER_ORDERING",
  "MATERIAL_CONFLICT",
]);

export class RetryableProcessingError extends Error {
  public readonly code: string;
  public readonly failureClass: FailureClass = FAILURE_CLASS.RETRYABLE;

  public constructor(
    code: string = FAILURE_CODE.TEMPORARY_UNAVAILABLE,
    message = "Temporary processing failure",
  ) {
    super(message);
    this.name = "RetryableProcessingError";
    this.code = code;
  }
}

export function safeFailureCode(code: string): string {
  if (/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
    return code;
  }
  return FAILURE_CODE.TRANSIENT_INTERNAL_ERROR;
}

export function classifyFailure(code: string): FailureClass {
  if (NON_RETRYABLE_CODES.has(code)) {
    return FAILURE_CLASS.NON_RETRYABLE;
  }
  return FAILURE_CLASS.RETRYABLE;
}

export function classifyProcessingError(error: unknown): {
  readonly failureClass: FailureClass;
  readonly code: string;
} {
  if (error instanceof RetryableProcessingError) {
    return {
      failureClass: FAILURE_CLASS.RETRYABLE,
      code: safeFailureCode(error.code),
    };
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = safeFailureCode(String(error.code));
    return { failureClass: classifyFailure(code), code };
  }
  return {
    failureClass: FAILURE_CLASS.RETRYABLE,
    code: FAILURE_CODE.TRANSIENT_INTERNAL_ERROR,
  };
}
