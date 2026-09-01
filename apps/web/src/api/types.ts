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
