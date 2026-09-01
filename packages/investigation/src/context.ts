import type { Instant, PaymentId, PaymentState, ProviderId } from "@hookx/domain";
import type { ExceptionCode, ExceptionSeverity, ExceptionStatus } from "@hookx/exceptions";
import type { AuditMetadata } from "@hookx/audit";
import { sha256Hex } from "./hash.js";

export type InvestigationExceptionView = {
  readonly exceptionId: string;
  readonly exceptionCode: ExceptionCode;
  readonly severity: ExceptionSeverity;
  readonly status: ExceptionStatus;
  readonly reason: string;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly provider: ProviderId | null;
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly metadata: AuditMetadata;
};

export type InvestigationIncidentView = {
  readonly incidentId: string;
  readonly exceptionId: string;
  readonly exceptionCode: ExceptionCode;
  readonly severity: ExceptionSeverity;
  readonly status: ExceptionStatus;
  readonly provider: ProviderId | null;
  readonly paymentId: PaymentId | null;
  readonly eventId: string | null;
  readonly detectedAt: Instant;
  readonly synthetic: boolean;
};

export type InvestigationPaymentView = {
  readonly paymentId: PaymentId;
  readonly provider: ProviderId;
  readonly state: PaymentState;
  readonly amountMinor: string;
  readonly currency: string;
  readonly lastOccurredAt: Instant;
};

export type InvestigationWebhookView = {
  readonly webhookEventId: string;
  readonly externalEventId: string;
  readonly eventType: string;
  readonly occurredAt: Instant;
  readonly receivedAt: Instant;
  readonly processingStatus: string;
  readonly amountMinor: string;
  readonly currency: string;
};

export type InvestigationRetryView = {
  readonly retryId: string;
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly status: string;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: Instant | null;
  readonly deadLettered: boolean;
};

export type InvestigationAuditView = {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly previousState: PaymentState | null;
  readonly resultingState: PaymentState | null;
  readonly reason: string;
  readonly actor: string;
};

export type InvestigationReplayView = {
  readonly delayed: boolean;
  readonly deliveryOrder: readonly string[];
  readonly eventTimeOrder: readonly string[];
  readonly orderingMismatch: boolean;
};

export type InvestigationRuleView = {
  readonly id: string;
  readonly statement: string;
};

/**
 * Minimized, structured evidence for an investigator. Contains no write
 * handles, secrets, signatures, raw payloads, or provider credentials.
 */
export type InvestigationContext = {
  readonly investigatedAt: Instant;
  readonly correlationId: string;
  readonly incident: InvestigationIncidentView;
  readonly exception: InvestigationExceptionView;
  readonly payment: InvestigationPaymentView | null;
  readonly webhooks: readonly InvestigationWebhookView[];
  readonly retries: readonly InvestigationRetryView[];
  readonly audit: readonly InvestigationAuditView[];
  readonly replay: InvestigationReplayView;
  readonly applicableRules: readonly InvestigationRuleView[];
  readonly evidenceHash: string;
};

/** Alias required by the Investigator contract. Same object as context. */
export type InvestigationInput = InvestigationContext;

export type InvestigationEvidencePayload = Omit<
  InvestigationContext,
  "evidenceHash"
>;

export function investigationEvidencePayload(
  context: InvestigationEvidencePayload,
): InvestigationEvidencePayload {
  return {
    investigatedAt: context.investigatedAt,
    correlationId: context.correlationId,
    incident: context.incident,
    exception: context.exception,
    payment: context.payment,
    webhooks: context.webhooks,
    retries: context.retries,
    audit: context.audit,
    replay: context.replay,
    applicableRules: context.applicableRules,
  };
}

export function computeEvidenceHash(
  context: InvestigationEvidencePayload,
): string {
  return sha256Hex(JSON.stringify(investigationEvidencePayload(context)));
}

export function withEvidenceHash(
  context: InvestigationEvidencePayload,
): InvestigationContext {
  return Object.freeze({
    ...context,
    incident: context.incident,
    exception: context.exception,
    payment: context.payment,
    webhooks: context.webhooks,
    retries: context.retries,
    audit: context.audit,
    replay: context.replay,
    applicableRules: context.applicableRules,
    evidenceHash: computeEvidenceHash(context),
  });
}

export function replayViewFromEvidence(
  webhooks: readonly InvestigationWebhookView[],
  audit: readonly InvestigationAuditView[],
): InvestigationReplayView {
  const byReceived = webhooks.slice().sort((left, right) => {
    if (left.receivedAt < right.receivedAt) {
      return -1;
    }
    if (left.receivedAt > right.receivedAt) {
      return 1;
    }
    return left.webhookEventId < right.webhookEventId ? -1 : 1;
  });
  const byOccurred = webhooks.slice().sort((left, right) => {
    if (left.occurredAt < right.occurredAt) {
      return -1;
    }
    if (left.occurredAt > right.occurredAt) {
      return 1;
    }
    return left.webhookEventId < right.webhookEventId ? -1 : 1;
  });
  const deliveryOrder = Object.freeze(byReceived.map((row) => row.webhookEventId));
  const eventTimeOrder = Object.freeze(byOccurred.map((row) => row.webhookEventId));
  const delayed = audit.some((row) => row.eventType === "WEBHOOK_DELAYED");
  const orderingMismatch = deliveryOrder.some(
    (id, index) => id !== eventTimeOrder[index],
  );
  return Object.freeze({
    delayed,
    deliveryOrder,
    eventTimeOrder,
    orderingMismatch: delayed || orderingMismatch,
  });
}

/** JSON sent to a model. Explicit allow-list so extra store fields cannot leak. */
export function serializeInvestigationContext(
  context: InvestigationContext,
): string {
  const payload: InvestigationEvidencePayload & { readonly evidenceHash: string } =
    {
      ...investigationEvidencePayload(context),
      evidenceHash: context.evidenceHash,
    };
  return JSON.stringify(payload);
}
