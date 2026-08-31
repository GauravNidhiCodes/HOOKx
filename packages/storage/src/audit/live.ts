import {
  AUDIT_REASON,
  type AuditActor,
  type AuditEventType,
} from "@hookx/audit";
import type { Instant, PaymentState, ProviderId } from "@hookx/domain";
import type { ReplayDecision } from "@hookx/state-machine";
import type { StoredWebhookEvent } from "../types.js";
import type { AuditAppendInput } from "./repository.js";

export type LiveAuditContext = {
  readonly stored: StoredWebhookEvent;
  readonly now: Instant;
  readonly correlationId: string;
  readonly actor: AuditActor;
  readonly attempt: number;
};

function stateOf(value: ReplayDecision["previousState"]): PaymentState | null {
  return value;
}

export function ingestRejectionDraft(
  input: {
    readonly now: Instant;
    readonly correlationId: string;
    readonly provider: ProviderId | null;
    readonly reason: string;
    readonly occurredAt?: Instant;
  },
): AuditAppendInput {
  return {
    eventType: "WEBHOOK_REJECTED",
    occurredAt: input.occurredAt ?? input.now,
    recordedAt: input.now,
    provider: input.provider,
    paymentId: null,
    webhookEventId: null,
    previousState: null,
    resultingState: null,
    actor: "SYSTEM",
    reason: input.reason,
    correlationId: input.correlationId,
  };
}

export function webhookReceiptDraft(
  stored: StoredWebhookEvent,
  now: Instant,
  correlationId: string,
  eventType: Extract<
    AuditEventType,
    "WEBHOOK_RECEIVED" | "WEBHOOK_DUPLICATE" | "WEBHOOK_CONFLICT"
  >,
  reason: string,
): AuditAppendInput {
  return {
    eventType,
    occurredAt: stored.event.occurredAt,
    recordedAt: now,
    provider: stored.event.provider,
    paymentId: stored.event.paymentId,
    webhookEventId: stored.id,
    previousState: null,
    resultingState: null,
    actor: "WEBHOOK_PROVIDER",
    reason,
    correlationId,
    metadata: { eventType: stored.event.eventType },
  };
}

export function retryLifecycleDraft(
  context: LiveAuditContext,
  eventType: Extract<
    AuditEventType,
    | "RETRY_SCHEDULED"
    | "RETRY_ATTEMPTED"
    | "RETRY_SUCCEEDED"
    | "RETRY_DEAD_LETTERED"
  >,
  reason: string,
): AuditAppendInput {
  return {
    eventType,
    occurredAt: context.now,
    recordedAt: context.now,
    provider: context.stored.event.provider,
    paymentId: context.stored.event.paymentId,
    webhookEventId: context.stored.id,
    previousState: null,
    resultingState: null,
    actor: context.actor,
    reason,
    correlationId: context.correlationId,
    metadata: { attempt: context.attempt },
  };
}

export function outcomeDraftsFromDecision(
  context: LiveAuditContext,
  decision: ReplayDecision | undefined,
): AuditAppendInput[] {
  if (decision === undefined) {
    return [];
  }
  if (decision.decision === "ACCEPTED") {
    return [
      {
        eventType: "PAYMENT_STATE_CHANGED",
        occurredAt: context.stored.event.occurredAt,
        recordedAt: context.now,
        provider: context.stored.event.provider,
        paymentId: context.stored.event.paymentId,
        webhookEventId: context.stored.id,
        previousState: stateOf(decision.previousState),
        resultingState: stateOf(decision.resultingState),
        actor: "SYSTEM",
        reason: AUDIT_REASON.ACCEPTED,
        correlationId: context.correlationId,
        metadata: { eventType: context.stored.event.eventType },
      },
    ];
  }
  if (decision.decision === "DELAYED") {
    return [
      {
        eventType: "WEBHOOK_DELAYED",
        occurredAt: context.stored.event.occurredAt,
        recordedAt: context.now,
        provider: context.stored.event.provider,
        paymentId: context.stored.event.paymentId,
        webhookEventId: context.stored.id,
        previousState: stateOf(decision.previousState),
        resultingState: stateOf(decision.resultingState),
        actor: "SYSTEM",
        reason:
          decision.reason === "AWAITING_PREREQUISITE"
            ? AUDIT_REASON.AWAITING_PREREQUISITE
            : AUDIT_REASON.OUT_OF_ORDER,
        correlationId: context.correlationId,
        metadata: { eventType: context.stored.event.eventType },
      },
    ];
  }
  if (decision.decision === "REJECTED") {
    return [
      {
        eventType: "PAYMENT_STATE_CHANGED",
        occurredAt: context.stored.event.occurredAt,
        recordedAt: context.now,
        provider: context.stored.event.provider,
        paymentId: context.stored.event.paymentId,
        webhookEventId: context.stored.id,
        previousState: stateOf(decision.previousState),
        resultingState: stateOf(decision.previousState),
        actor: "SYSTEM",
        reason: AUDIT_REASON.INVALID_TRANSITION,
        correlationId: context.correlationId,
        metadata: { eventType: context.stored.event.eventType },
      },
    ];
  }
  if (decision.decision === "CONFLICT") {
    return [
      {
        eventType: "WEBHOOK_CONFLICT",
        occurredAt: context.stored.event.occurredAt,
        recordedAt: context.now,
        provider: context.stored.event.provider,
        paymentId: context.stored.event.paymentId,
        webhookEventId: context.stored.id,
        previousState: stateOf(decision.previousState),
        resultingState: stateOf(decision.resultingState),
        actor: "SYSTEM",
        reason: AUDIT_REASON.CONFLICTING_EVENT,
        correlationId: context.correlationId,
      },
    ];
  }
  return [];
}

export function retryFailureReason(
  code: string,
  exhaustedByAttempts: boolean,
): string {
  if (exhaustedByAttempts) {
    return AUDIT_REASON.MAX_RETRIES_EXCEEDED;
  }
  if (
    code === "TEMPORARY_UNAVAILABLE" ||
    code === "TEMPORARY_DATABASE_FAILURE" ||
    code === "TRANSIENT_INTERNAL_ERROR"
  ) {
    return AUDIT_REASON.TEMPORARY_PROCESSING_FAILURE;
  }
  return code;
}
