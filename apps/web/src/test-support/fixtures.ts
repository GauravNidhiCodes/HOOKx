import { vi } from "vitest";
import type { HookxApi } from "../api/client";
import type {
  PublicAuditEvent,
  PublicException,
  PublicInvestigation,
  PublicPayment,
  PublicRetry,
  PublicWebhookEvent,
} from "../api/types";

export const EXCEPTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const WEBHOOK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CAPTURE_WEBHOOK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
  lastOccurredAt: "2026-01-15T14:02:18.000Z",
  updatedAt: "2026-01-15T14:02:18.000Z",
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
    getPayment: vi.fn(async () => samplePayment),
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
