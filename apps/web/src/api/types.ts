import type { PublicException } from "@hookx/exceptions/catalog";
import type {
  InvestigationEvidence,
  InvestigationRecord,
  InvestigationResult,
} from "@hookx/investigation";

export type {
  PublicException,
  InvestigationEvidence,
  InvestigationRecord,
  InvestigationResult,
};

export type PublicPayment = {
  readonly provider: string;
  readonly paymentId: string;
  readonly state: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly lastOccurredAt: string;
  readonly updatedAt: string;
};

export type PublicPaymentListItem = PublicPayment & {
  readonly exceptionCount: number;
};

export type PublicWebhookEvent = {
  readonly webhookEventId: string;
  readonly provider: string;
  readonly externalEventId: string;
  readonly paymentId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly processingStatus: string;
  readonly deliveryAttempt: number;
};

export type PublicAuditEvent = {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly webhookEventId: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly actor: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
};

export type PublicRetry = {
  readonly webhookEventId: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly status: string;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: string | null;
};

export type PublicDeadLetter = {
  readonly webhookEventId: string;
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: string;
};

export type PublicInvestigation = {
  readonly investigationId: string;
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly result: InvestigationResult;
};

export type PublicIncident = {
  readonly incidentId: string;
  readonly exceptionId: string;
  readonly exceptionCode: string;
  readonly severity: string;
  readonly status: string;
  readonly paymentId: string | null;
  readonly eventId: string | null;
  readonly correlationId: string;
  readonly provider: string | null;
  readonly detectedAt: string;
  readonly reason: string;
  readonly synthetic: boolean;
};

export type PublicIncidentTimelineItem = {
  readonly seq: number;
  readonly clock: string;
  readonly eventTime: string | null;
  readonly receivedTime: string | null;
  readonly processedTime: string | null;
  readonly lifecycle: string;
  readonly decision: string | null;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly provider: string | null;
  readonly paymentId: string | null;
  readonly eventId: string | null;
  readonly exceptionId: string | null;
  readonly exceptionCode: string | null;
  readonly previousState: string | null;
  readonly resultingState: string | null;
  readonly source: string;
  readonly sourceId: string;
  readonly inferred: boolean;
  readonly synthetic: boolean;
  readonly retry: {
    readonly attempt: number | null;
    readonly scheduledAt: string | null;
    readonly attemptedAt: string | null;
    readonly result: string | null;
    readonly failureClass: string | null;
  } | null;
  readonly replay: {
    readonly replayId: string;
    readonly trigger: string;
    readonly eventsConsidered: number;
    readonly previousState: string | null;
    readonly resultingState: string | null;
  } | null;
};

export type IncidentListQuery = {
  readonly status?: string;
  readonly severity?: string;
  readonly exceptionCode?: string;
  readonly provider?: string;
  readonly from?: string;
  readonly to?: string;
};

export type ExceptionListQuery = {
  readonly status?: string;
  readonly severity?: string;
  readonly exceptionCode?: string;
  readonly provider?: string;
  readonly paymentId?: string;
  readonly q?: string;
};

export type PaymentListQuery = {
  readonly q?: string;
  readonly provider?: string;
  readonly state?: string;
};

export type WebhookListQuery = {
  readonly q?: string;
  readonly eventType?: string;
  readonly processingStatus?: string;
  readonly paymentId?: string;
  readonly provider?: string;
};

export const PUBLIC_EXCEPTION_KEYS = [
  "exceptionId",
  "exceptionCode",
  "severity",
  "paymentId",
  "webhookEventId",
  "provider",
  "status",
  "reason",
  "detectedAt",
  "correlationId",
  "metadata",
] as const;

export const INVESTIGATION_RESULT_KEYS = [
  "summary",
  "facts",
  "evidence",
  "likelyCause",
  "recommendedAction",
  "confidence",
  "limitations",
] as const;
