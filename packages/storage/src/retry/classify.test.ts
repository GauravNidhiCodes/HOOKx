import { describe, expect, it } from "vitest";
import { WebhookError } from "@hookx/webhook";
import {
  classifyFailure,
  classifyProcessingError,
  FAILURE_CLASS,
  FAILURE_CODE,
  RetryableProcessingError,
  safeFailureCode,
} from "./classify.js";

describe("failure classification", () => {
  it("marks temporary failures as retryable", () => {
    expect(classifyFailure(FAILURE_CODE.TEMPORARY_UNAVAILABLE)).toBe(
      FAILURE_CLASS.RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.TEMPORARY_DATABASE_FAILURE)).toBe(
      FAILURE_CLASS.RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.TRANSIENT_INTERNAL_ERROR)).toBe(
      FAILURE_CLASS.RETRYABLE,
    );
    expect(
      classifyProcessingError(new RetryableProcessingError()).failureClass,
    ).toBe(FAILURE_CLASS.RETRYABLE);
  });

  it("marks permanent domain and validation failures as non-retryable", () => {
    expect(classifyFailure(FAILURE_CODE.INVALID_SIGNATURE)).toBe(
      FAILURE_CLASS.NON_RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.MALFORMED_PAYLOAD)).toBe(
      FAILURE_CLASS.NON_RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.INVALID_TRANSITION)).toBe(
      FAILURE_CLASS.NON_RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.PERMANENT_CONFLICT)).toBe(
      FAILURE_CLASS.NON_RETRYABLE,
    );
    expect(classifyFailure(FAILURE_CODE.UNSUPPORTED_EVENT)).toBe(
      FAILURE_CLASS.NON_RETRYABLE,
    );
    expect(
      classifyProcessingError(new WebhookError("INVALID_PAYLOAD", "bad")).code,
    ).toBe("INVALID_PAYLOAD");
    expect(
      classifyProcessingError(new WebhookError("INVALID_PAYLOAD", "bad"))
        .failureClass,
    ).toBe(FAILURE_CLASS.NON_RETRYABLE);
  });

  it("never stores stack traces as failure codes", () => {
    expect(safeFailureCode("TEMPORARY_UNAVAILABLE")).toBe(
      "TEMPORARY_UNAVAILABLE",
    );
    expect(safeFailureCode("Error: boom\n    at foo.js:1")).toBe(
      FAILURE_CODE.TRANSIENT_INTERNAL_ERROR,
    );
  });
});
