import type { Instant, PaymentId, PaymentState, ProviderId } from "@hookx/domain";
import type { ExceptionCode, ExceptionSeverity, ExceptionStatus } from "@hookx/exceptions";
import type { AuditMetadata } from "@hookx/audit";

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
  readonly exception: InvestigationExceptionView;
  readonly payment: InvestigationPaymentView | null;
  readonly webhooks: readonly InvestigationWebhookView[];
  readonly retries: readonly InvestigationRetryView[];
  readonly audit: readonly InvestigationAuditView[];
  readonly applicableRules: readonly InvestigationRuleView[];
};

/** JSON sent to a model. Explicit allow-list so extra store fields cannot leak. */
export function serializeInvestigationContext(
  context: InvestigationContext,
): string {
  return JSON.stringify({
    investigatedAt: context.investigatedAt,
    correlationId: context.correlationId,
    exception: context.exception,
    payment: context.payment,
    webhooks: context.webhooks,
    retries: context.retries,
    audit: context.audit,
    applicableRules: context.applicableRules,
  });
}
