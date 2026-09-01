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
  readonly incidentId?: string;
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly evidenceHash?: string;
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

export type FailureLabScenarioId =
  | "DUPLICATE_DELIVERY"
  | "OUT_OF_ORDER"
  | "CONFLICTING_EVENT"
  | "TRANSIENT_FAILURE"
  | "RETRY_EXHAUSTION"
  | "REPLAY_RECOVERY";

export type FailureLabCatalogEntry = {
  readonly id: FailureLabScenarioId;
  readonly number: string;
  readonly title: string;
  readonly explanation: string;
  readonly expected: string;
  readonly failureMode: string;
};

export type FailureLabCatalog = {
  readonly notice: string;
  readonly synthetic: true;
  readonly scenarios: readonly FailureLabCatalogEntry[];
};

export type FailureLabLogEntry = {
  readonly clock: string;
  readonly lifecycle: string;
  readonly decision: string | null;
  readonly inferred: boolean;
};

export type FailureLabRunReport = {
  readonly runId: string;
  readonly scenario: FailureLabScenarioId;
  readonly title: string;
  readonly synthetic: true;
  readonly notice: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly failureMode: string;
  readonly retryPolicy: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
  readonly input: {
    readonly deliveries: number;
    readonly eventOrderSent: readonly string[];
    readonly eventTimeOrder: readonly string[];
  };
  readonly result: {
    readonly processed: number;
    readonly duplicate: number;
    readonly conflict: number;
    readonly error: number;
    readonly accepted: number;
  };
  readonly stateChange: number;
  readonly payment: {
    readonly paymentId: string;
    readonly state: string | null;
    readonly amountMinor: string | null;
  };
  readonly originalAmountMinor: string | null;
  readonly originalPayloadHash: string | null;
  readonly exception: {
    readonly exceptionId: string;
    readonly exceptionCode: string;
  } | null;
  readonly incidentId: string | null;
  readonly auditCount: number;
  readonly retry: {
    readonly attemptCount: number;
    readonly status: string;
    readonly nextAttemptAt: string | null;
    readonly lastErrorCode: string | null;
    readonly lastFailedAt: string | null;
    readonly failureClass: string | null;
  } | null;
  readonly deadLetter: {
    readonly failureCode: string;
    readonly attemptCount: number;
    readonly deadLetteredAt: string;
  } | null;
  readonly replay: {
    readonly beforeState: string | null;
    readonly afterState: string | null;
    readonly delayed: boolean;
  } | null;
  readonly log: readonly FailureLabLogEntry[];
  readonly deliveries: readonly {
    readonly stepIndex: number;
    readonly eventType: string;
    readonly eventKey: string;
    readonly httpStatus: number;
    readonly bodyStatus: string;
    readonly code: string | null;
    readonly kind: string;
  }[];
  readonly links: {
    readonly incident: string | null;
    readonly payment: string | null;
    readonly event: string | null;
  };
};

export type FailureLabResetResult = {
  readonly notice: string;
  readonly deleted: {
    readonly investigations: number;
    readonly exceptions: number;
    readonly deadLetters: number;
    readonly retries: number;
    readonly audit: number;
    readonly webhooks: number;
    readonly payments: number;
  };
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
  "incidentType",
  "severity",
  "rootCause",
  "likelyCause",
  "impact",
  "recommendedActions",
  "recommendedAction",
  "confidence",
  "confidenceReason",
  "limitations",
] as const;
