import { vi } from "vitest";
import type { HookxApi } from "../api/client";
import type {
  PublicAuditEvent,
  PublicException,
  PublicInvestigation,
  PublicPayment,
  PublicPaymentListItem,
  PublicRetry,
  PublicWebhookEvent,
} from "../api/types";

export const EXCEPTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const WEBHOOK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CAPTURE_WEBHOOK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const AUTH_WEBHOOK_ID = "99999999-9999-4999-8999-999999999999";
export const PAYMENT_ID = "SYNTHETIC:pay:ui-console";

export const sampleException = {
  exceptionId: EXCEPTION_ID,
  exceptionCode: "CONFLICTING_EVENT",
  severity: "ERROR",
  paymentId: PAYMENT_ID,
  webhookEventId: WEBHOOK_ID,
  provider: "SYNTHETIC",
  status: "OPEN",
  reason: "CONFLICTING_EVENT",
  detectedAt: "2026-01-15T14:02:18.000Z",
  correlationId: "corr-ui-1",
  metadata: { originalAuthoritative: true },
} as unknown as PublicException;

export const retryException: PublicException = {
  ...sampleException,
  exceptionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  exceptionCode: "PROCESSING_FAILURE",
  severity: "ERROR",
  reason: "PROCESSING_FAILURE",
};

export const samplePayment: PublicPayment = {
  provider: "SYNTHETIC",
  paymentId: PAYMENT_ID,
  state: "CAPTURED",
  amountMinor: "10000",
  currency: "INR",
  createdAt: "2026-01-15T14:02:11.000Z",
  lastOccurredAt: "2026-01-15T14:02:18.000Z",
  updatedAt: "2026-01-15T14:02:18.000Z",
};

export const samplePaymentListItem: PublicPaymentListItem = {
  ...samplePayment,
  exceptionCount: 1,
};

export const sampleWebhooks: readonly PublicWebhookEvent[] = [
  {
    webhookEventId: WEBHOOK_ID,
    provider: "SYNTHETIC",
    externalEventId: "SYNTHETIC:evt:ui-created",
    paymentId: PAYMENT_ID,
    eventType: "payment.created",
    occurredAt: "2026-01-15T14:02:11.000Z",
    receivedAt: "2026-01-15T14:02:11.100Z",
    amountMinor: "10000",
    currency: "INR",
    processingStatus: "PROCESSED",
    deliveryAttempt: 1,
  },
  {
    webhookEventId: CAPTURE_WEBHOOK_ID,
    provider: "SYNTHETIC",
    externalEventId: "SYNTHETIC:evt:ui-captured",
    paymentId: PAYMENT_ID,
    eventType: "payment.captured",
    occurredAt: "2026-01-15T14:02:14.000Z",
    receivedAt: "2026-01-15T14:02:14.100Z",
    amountMinor: "10000",
    currency: "INR",
    processingStatus: "PROCESSED",
    deliveryAttempt: 1,
  },
];

export const outOfOrderWebhooks: readonly PublicWebhookEvent[] = [
  {
    webhookEventId: WEBHOOK_ID,
    provider: "SYNTHETIC",
    externalEventId: "SYNTHETIC:evt:ui-created",
    paymentId: PAYMENT_ID,
    eventType: "payment.created",
    occurredAt: "2026-01-15T14:02:11.000Z",
    receivedAt: "2026-01-15T14:02:11.100Z",
    amountMinor: "10000",
    currency: "INR",
    processingStatus: "PROCESSED",
    deliveryAttempt: 1,
  },
  {
    webhookEventId: CAPTURE_WEBHOOK_ID,
    provider: "SYNTHETIC",
    externalEventId: "SYNTHETIC:evt:ui-captured",
    paymentId: PAYMENT_ID,
    eventType: "payment.captured",
    occurredAt: "2026-01-15T14:02:14.000Z",
    receivedAt: "2026-01-15T14:02:12.000Z",
    amountMinor: "10000",
    currency: "INR",
    processingStatus: "PROCESSED",
    deliveryAttempt: 1,
  },
  {
    webhookEventId: AUTH_WEBHOOK_ID,
    provider: "SYNTHETIC",
    externalEventId: "SYNTHETIC:evt:ui-authorized",
    paymentId: PAYMENT_ID,
    eventType: "payment.authorized",
    occurredAt: "2026-01-15T14:02:13.000Z",
    receivedAt: "2026-01-15T14:02:15.000Z",
    amountMinor: "10000",
    currency: "INR",
    processingStatus: "PROCESSED",
    deliveryAttempt: 1,
  },
];

export const sampleAudit: readonly PublicAuditEvent[] = [
  {
    auditEventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    eventType: "PAYMENT_STATE_CHANGED",
    occurredAt: "2026-01-15T14:02:11.000Z",
    recordedAt: "2026-01-15T14:02:11.200Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: WEBHOOK_ID,
    previousState: null,
    resultingState: "CREATED",
    actor: "SYSTEM",
    reason: "TRANSITION",
    correlationId: "corr-ui-created",
    metadata: {},
  },
  {
    auditEventId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    eventType: "PAYMENT_STATE_CHANGED",
    occurredAt: "2026-01-15T14:02:13.000Z",
    recordedAt: "2026-01-15T14:02:13.200Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: AUTH_WEBHOOK_ID,
    previousState: "CREATED",
    resultingState: "AUTHORIZED",
    actor: "SYSTEM",
    reason: "TRANSITION",
    correlationId: "corr-ui-authorized",
    metadata: {},
  },
  {
    auditEventId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    eventType: "WEBHOOK_DELAYED",
    occurredAt: "2026-01-15T14:02:14.000Z",
    recordedAt: "2026-01-15T14:02:14.200Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: CAPTURE_WEBHOOK_ID,
    previousState: "CREATED",
    resultingState: "CREATED",
    actor: "SYSTEM",
    reason: "OUT_OF_ORDER",
    correlationId: "corr-ui-delayed",
    metadata: {},
  },
  {
    auditEventId: "11111111-1111-4111-8111-111111111111",
    eventType: "PAYMENT_STATE_CHANGED",
    occurredAt: "2026-01-15T14:02:18.000Z",
    recordedAt: "2026-01-15T14:02:18.200Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: CAPTURE_WEBHOOK_ID,
    previousState: "AUTHORIZED",
    resultingState: "CAPTURED",
    actor: "SYSTEM",
    reason: "TRANSITION",
    correlationId: "corr-ui-replay",
    metadata: {},
  },
];

export const sampleRetryAudit: readonly PublicAuditEvent[] = [
  {
    auditEventId: "33333333-3333-4333-8333-333333333333",
    eventType: "RETRY_SCHEDULED",
    occurredAt: "2026-01-15T14:02:20.000Z",
    recordedAt: "2026-01-15T14:02:20.000Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: WEBHOOK_ID,
    previousState: null,
    resultingState: null,
    actor: "SYSTEM",
    reason: "TEMPORARY_PROCESSING_FAILURE",
    correlationId: "corr-ui-retry-1",
    metadata: { attempt: 1 },
  },
  {
    auditEventId: "44444444-4444-4444-8444-444444444444",
    eventType: "RETRY_ATTEMPTED",
    occurredAt: "2026-01-15T14:03:18.000Z",
    recordedAt: "2026-01-15T14:03:18.000Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: WEBHOOK_ID,
    previousState: null,
    resultingState: null,
    actor: "SYSTEM",
    reason: "TEMPORARY_PROCESSING_FAILURE",
    correlationId: "corr-ui-retry-2",
    metadata: { attempt: 2 },
  },
  {
    auditEventId: "55555555-5555-4555-8555-555555555555",
    eventType: "RETRY_SUCCEEDED",
    occurredAt: "2026-01-15T14:03:18.100Z",
    recordedAt: "2026-01-15T14:03:18.100Z",
    provider: "SYNTHETIC",
    paymentId: PAYMENT_ID,
    webhookEventId: WEBHOOK_ID,
    previousState: null,
    resultingState: null,
    actor: "SYSTEM",
    reason: "ACCEPTED",
    correlationId: "corr-ui-retry-3",
    metadata: { attempt: 2 },
  },
];

export const sampleRetry: PublicRetry = {
  webhookEventId: WEBHOOK_ID,
  attemptCount: 2,
  maxAttempts: 5,
  status: "PENDING",
  nextAttemptAt: "2026-01-15T14:03:18.000Z",
  lastErrorCode: "TEMPORARY_PROCESSING_FAILURE",
  lastFailedAt: "2026-01-15T14:02:20.000Z",
};

export const sampleInvestigation: PublicInvestigation = {
  investigationId: "22222222-2222-4222-8222-222222222222",
  exceptionId: EXCEPTION_ID,
  investigator: "stub",
  modelId: null,
  promptVersion: "investigation.v1",
  createdAt: "2026-01-15T14:05:00.000Z",
  correlationId: "corr-ui-invest",
  result: {
    summary: "Deterministic conflict classification with no financial mutation.",
    facts: ["Exception remains CONFLICTING_EVENT."],
    evidence: [
      {
        sourceType: "EXCEPTION",
        sourceId: EXCEPTION_ID,
        fact: "Deterministic engine classified CONFLICTING_EVENT.",
      },
      {
        sourceType: "WEBHOOK_EVENT",
        sourceId: WEBHOOK_ID,
        fact: "Stored webhook identity was retained.",
      },
    ],
    likelyCause: "The provider may have retried the same event identity with a different payload.",
    recommendedAction: {
      code: "INVESTIGATE_CONFLICTING_PAYLOAD",
      detail: "Compare the stored event with the rejected delivery. Do not capture or refund.",
      executable: false,
    },
    confidence: "MEDIUM",
    limitations: ["Investigation does not change payment state."],
  },
};

export function createMockApi(overrides: Partial<HookxApi> = {}): HookxApi {
  return {
    listExceptions: vi.fn(async () => [sampleException]),
    getException: vi.fn(async () => sampleException),
    listPayments: vi.fn(async () => [samplePaymentListItem]),
    getPayment: vi.fn(async () => samplePayment),
    listPaymentExceptions: vi.fn(async () => [sampleException]),
    listWebhooks: vi.fn(async () => sampleWebhooks),
    getWebhook: vi.fn(async () => sampleWebhooks[0] ?? null),
    listPaymentWebhooks: vi.fn(async () => sampleWebhooks),
    listPaymentAudit: vi.fn(async () => sampleAudit),
    listWebhookAudit: vi.fn(async () => sampleAudit),
    getRetry: vi.fn(async () => null),
    getDeadLetter: vi.fn(async () => null),
    getInvestigation: vi.fn(async () => null),
    investigate: vi.fn(async () => sampleInvestigation),
    ...overrides,
  };
}
