import type { PaymentRecordState, ReplayDecisionKind, ReplayReason } from "@hookx/state-machine";
import type { WebhookEventType } from "@hookx/webhook";

export type DetectionFact =
  | { readonly kind: "INVALID_SIGNATURE"; readonly reason: string }
  | { readonly kind: "MALFORMED_WEBHOOK"; readonly reason: string }
  | { readonly kind: "UNSUPPORTED_EVENT"; readonly reason: string }
  | { readonly kind: "DUPLICATE_EVENT" }
  | { readonly kind: "CONFLICTING_EVENT" }
  | {
      readonly kind: "OUT_OF_ORDER_EVENT";
      readonly previousState: PaymentRecordState;
      readonly eventType: WebhookEventType;
      readonly reason: string;
    }
  | {
      readonly kind: "INVALID_STATE_TRANSITION";
      readonly previousState: PaymentRecordState | null;
      readonly eventType: WebhookEventType | null;
      readonly reason: string;
    }
  | {
      readonly kind: "PROCESSING_FAILURE";
      readonly failureCode: string;
      readonly attemptCount?: number;
    }
  | {
      readonly kind: "RETRY_EXHAUSTED";
      readonly failureCode: string;
      readonly attemptCount: number;
    }
  | {
      readonly kind: "MISSING_EVENT";
      readonly missingEventType: WebhookEventType;
      readonly delayedEventType: WebhookEventType;
    };

const MALFORMED_CODES: ReadonlySet<string> = new Set([
  "MALFORMED_SIGNATURE",
  "INVALID_PAYLOAD",
  "INVALID_AMOUNT",
  "INVALID_CURRENCY",
  "INVALID_TIMESTAMP",
  "MISSING_EXTERNAL_ID",
  "MISSING_PAYMENT_ID",
  "INVALID_NORMALIZED_EVENT",
  "MALFORMED_PAYLOAD",
]);

const SIGNATURE_CODES: ReadonlySet<string> = new Set([
  "INVALID_SIGNATURE",
  "MISSING_SIGNATURE",
  "EXPIRED_SIGNATURE",
]);

export function factsFromVerificationStatus(status: string): DetectionFact[] {
  if (SIGNATURE_CODES.has(status)) {
    return [{ kind: "INVALID_SIGNATURE", reason: status }];
  }
  if (status === "MALFORMED_SIGNATURE") {
    return [{ kind: "MALFORMED_WEBHOOK", reason: status }];
  }
  if (status === "UNSUPPORTED_PROVIDER") {
    return [{ kind: "UNSUPPORTED_EVENT", reason: status }];
  }
  return [];
}

export function factsFromWebhookErrorCode(code: string): DetectionFact[] {
  if (code === "UNSUPPORTED_EVENT" || code === "UNSUPPORTED_PROVIDER") {
    return [{ kind: "UNSUPPORTED_EVENT", reason: code }];
  }
  if (MALFORMED_CODES.has(code)) {
    return [{ kind: "MALFORMED_WEBHOOK", reason: code }];
  }
  if (SIGNATURE_CODES.has(code)) {
    return [{ kind: "INVALID_SIGNATURE", reason: code }];
  }
  return [];
}

export function factsFromStoreOutcome(
  outcome: string | undefined,
): DetectionFact[] {
  if (outcome === "DUPLICATE") {
    return [{ kind: "DUPLICATE_EVENT" }];
  }
  if (outcome === "CONFLICT") {
    return [{ kind: "CONFLICTING_EVENT" }];
  }
  return [];
}

export function factsFromReplayDecision(input: {
  readonly decision: ReplayDecisionKind;
  readonly reason: ReplayReason;
  readonly previousState: PaymentRecordState;
  readonly eventType: WebhookEventType;
}): DetectionFact[] {
  if (input.decision === "DELAYED") {
    return [
      {
        kind: "OUT_OF_ORDER_EVENT",
        previousState: input.previousState,
        eventType: input.eventType,
        reason: input.reason,
      },
    ];
  }
  if (input.decision === "REJECTED") {
    return [
      {
        kind: "INVALID_STATE_TRANSITION",
        previousState: input.previousState,
        eventType: input.eventType,
        reason: input.reason === "PAYMENT_ID_MISMATCH"
          ? "PAYMENT_ID_MISMATCH"
          : "INVALID_TRANSITION",
      },
    ];
  }
  if (input.decision === "CONFLICT") {
    if (input.reason === "MATERIAL_CONFLICT") {
      return [{ kind: "CONFLICTING_EVENT" }];
    }
    return [
      {
        kind: "INVALID_STATE_TRANSITION",
        previousState: input.previousState,
        eventType: input.eventType,
        reason: input.reason,
      },
    ];
  }
  return [];
}

export function factsFromFailureCode(code: string): DetectionFact[] {
  if (
    code === "INVALID_TRANSITION" ||
    code === "IMPOSSIBLE_AFTER_ORDERING" ||
    code === "PAYMENT_ID_MISMATCH"
  ) {
    return [
      {
        kind: "INVALID_STATE_TRANSITION",
        previousState: null,
        eventType: null,
        reason: code,
      },
    ];
  }
  if (
    code === "PERMANENT_CONFLICT" ||
    code === "MATERIAL_CONFLICT" ||
    code === "CONFLICT"
  ) {
    return [{ kind: "CONFLICTING_EVENT" }];
  }
  const verification = factsFromVerificationStatus(code);
  if (verification.length > 0) {
    return verification;
  }
  const webhook = factsFromWebhookErrorCode(code);
  if (webhook.length > 0) {
    return webhook;
  }
  return [{ kind: "PROCESSING_FAILURE", failureCode: code }];
}

export function factsFromRetryOutcome(input: {
  readonly status: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly failureCode?: string;
  readonly exhaustedByAttempts?: boolean;
}): DetectionFact[] {
  const facts: DetectionFact[] = [];
  if (input.status === "RETRY_SCHEDULED") {
    facts.push({
      kind: "PROCESSING_FAILURE",
      failureCode: input.failureCode ?? "TEMPORARY_PROCESSING_FAILURE",
      attemptCount: input.attemptCount,
    });
  }
  if (input.status === "DEAD_LETTERED" && input.exhaustedByAttempts === true) {
    facts.push({
      kind: "RETRY_EXHAUSTED",
      failureCode: input.failureCode ?? "MAX_RETRIES_EXCEEDED",
      attemptCount: input.attemptCount,
    });
  }
  if (
    input.status === "DEAD_LETTERED" &&
    input.exhaustedByAttempts !== true &&
    input.failureCode !== undefined
  ) {
    facts.push(...factsFromFailureCode(input.failureCode));
  }
  return facts;
}
