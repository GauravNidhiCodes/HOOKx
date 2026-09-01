import type { Instant, PaymentId, ProviderId } from "@hookx/domain";
import { createExceptionDraft, type ExceptionDraft } from "./exception.js";
import type { DetectionFact } from "./facts.js";
import { uniqueMissingPrerequisite } from "./missing-prerequisite.js";
import { compareExceptionCode } from "./precedence.js";
import type { ExceptionCode } from "./codes.js";

export type DetectionContext = {
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly provider: ProviderId | null;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly facts: readonly DetectionFact[];
};

export type ExceptionDetectionResult = {
  readonly exceptions: readonly ExceptionDraft[];
};

function expandFacts(facts: readonly DetectionFact[]): DetectionFact[] {
  const expanded = [...facts];
  const hasMissing = facts.some((fact) => fact.kind === "MISSING_EVENT");
  if (hasMissing) {
    return expanded;
  }
  for (const fact of facts) {
    if (fact.kind !== "OUT_OF_ORDER_EVENT") {
      continue;
    }
    if (fact.reason !== "AWAITING_PREREQUISITE" && fact.reason !== "OUT_OF_ORDER") {
      continue;
    }
    const missing = uniqueMissingPrerequisite(fact.previousState, fact.eventType);
    if (missing !== null) {
      expanded.push({
        kind: "MISSING_EVENT",
        missingEventType: missing,
        delayedEventType: fact.eventType,
      });
    }
  }
  return expanded;
}

function draftFromFact(
  context: DetectionContext,
  fact: DetectionFact,
): ExceptionDraft | null {
  const base = {
    paymentId: context.paymentId,
    webhookEventId: context.webhookEventId,
    provider: context.provider,
    detectedAt: context.detectedAt,
    correlationId: context.correlationId,
  };
  switch (fact.kind) {
    case "INVALID_SIGNATURE":
      return createExceptionDraft({
        ...base,
        exceptionCode: "INVALID_SIGNATURE",
        reason: fact.reason,
      });
    case "MALFORMED_WEBHOOK":
      return createExceptionDraft({
        ...base,
        exceptionCode: "MALFORMED_WEBHOOK",
        reason: fact.reason,
      });
    case "UNSUPPORTED_EVENT":
      return createExceptionDraft({
        ...base,
        exceptionCode: "UNSUPPORTED_EVENT",
        reason: fact.reason,
      });
    case "DUPLICATE_EVENT":
      return createExceptionDraft({
        ...base,
        exceptionCode: "DUPLICATE_EVENT",
        reason: "DUPLICATE_EVENT",
      });
    case "CONFLICTING_EVENT":
      return createExceptionDraft({
        ...base,
        exceptionCode: "CONFLICTING_EVENT",
        reason: "CONFLICTING_EVENT",
        metadata: { originalAuthoritative: true },
      });
    case "OUT_OF_ORDER_EVENT":
      return createExceptionDraft({
        ...base,
        exceptionCode: "OUT_OF_ORDER_EVENT",
        reason:
          fact.reason === "AWAITING_PREREQUISITE"
            ? "AWAITING_PREREQUISITE"
            : "OUT_OF_ORDER",
        metadata: {
          previousState: fact.previousState ?? "NONE",
          eventType: fact.eventType,
        },
      });
    case "INVALID_STATE_TRANSITION":
      return createExceptionDraft({
        ...base,
        exceptionCode: "INVALID_STATE_TRANSITION",
        reason: fact.reason,
        metadata: {
          previousState: fact.previousState ?? "NONE",
          ...(fact.eventType === null ? {} : { eventType: fact.eventType }),
          reasonCode: fact.reason,
        },
      });
    case "PROCESSING_FAILURE":
      return createExceptionDraft({
        ...base,
        exceptionCode: "PROCESSING_FAILURE",
        reason:
          /^[A-Z][A-Z0-9_]{0,63}$/.test(fact.failureCode)
            ? fact.failureCode
            : "TEMPORARY_PROCESSING_FAILURE",
        metadata:
          fact.attemptCount === undefined
            ? undefined
            : { attempt: fact.attemptCount },
      });
    case "RETRY_EXHAUSTED":
      return createExceptionDraft({
        ...base,
        exceptionCode: "RETRY_EXHAUSTED",
        reason: "MAX_RETRIES_EXCEEDED",
        metadata: { attempt: fact.attemptCount },
      });
    case "MISSING_EVENT":
      return createExceptionDraft({
        ...base,
        exceptionCode: "MISSING_EVENT",
        reason: "AWAITING_PREREQUISITE",
        metadata: {
          missingEventType: fact.missingEventType,
          delayedEventType: fact.delayedEventType,
        },
      });
    default: {
      const _never: never = fact;
      return _never;
    }
  }
}

function codeOf(fact: DetectionFact): ExceptionCode {
  return fact.kind;
}

/**
 * Pure exception classification. No database, network, clock, randomness, or LLM.
 * `detectedAt` and `correlationId` are injected by the caller.
 */
export function detectException(
  context: DetectionContext,
): ExceptionDetectionResult {
  const byCode = new Map<ExceptionCode, ExceptionDraft>();
  for (const fact of expandFacts(context.facts)) {
    const code = codeOf(fact);
    if (byCode.has(code)) {
      continue;
    }
    const draft = draftFromFact(context, fact);
    if (draft !== null) {
      byCode.set(code, draft);
    }
  }
  const exceptions = [...byCode.values()].sort((left, right) =>
    compareExceptionCode(left.exceptionCode, right.exceptionCode),
  );
  return Object.freeze({
    exceptions: Object.freeze(exceptions),
  });
}

/** @alias detectException */
export const detectExceptions = detectException;
