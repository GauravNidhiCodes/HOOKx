import { instant, paymentId, providerId } from "@hookx/domain";
import type { InvestigationContext } from "./context.js";
import { applicableRulesFor } from "./rules.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const DETECTED = instant("2026-01-15T10:00:00.000Z");

export const SAMPLE_EXCEPTION_ID = "11111111-1111-4111-8111-111111111111";
export const SAMPLE_WEBHOOK_ID = "22222222-2222-4222-8222-222222222222";
export const SAMPLE_AUDIT_ID = "33333333-3333-4333-8333-333333333333";
export const SAMPLE_RETRY_ID = "44444444-4444-4444-8444-444444444444";
export const SAMPLE_PAYMENT_ID = "SYNTHETIC:pay:inv-1";
export const SAMPLE_EXTERNAL_EVENT_ID = "SYNTHETIC:evt:inv-1";

export function sampleInvestigationContext(
  extras: Partial<InvestigationContext> = {},
): InvestigationContext {
  const exception = extras.exception ?? {
    exceptionId: SAMPLE_EXCEPTION_ID,
    exceptionCode: "CONFLICTING_EVENT",
    severity: "ERROR",
    status: "OPEN",
    reason: "CONFLICTING_EVENT",
    paymentId: paymentId(SAMPLE_PAYMENT_ID),
    webhookEventId: SAMPLE_WEBHOOK_ID,
    provider: providerId("SYNTHETIC"),
    detectedAt: DETECTED,
    correlationId: "corr-inv-1",
    metadata: Object.freeze({ originalAuthoritative: true }),
  };
  return {
    investigatedAt: extras.investigatedAt ?? NOW,
    correlationId: extras.correlationId ?? "corr-inv-1",
    exception,
    payment:
      extras.payment === undefined
        ? {
            paymentId: paymentId(SAMPLE_PAYMENT_ID),
            provider: providerId("SYNTHETIC"),
            state: "CREATED",
            amountMinor: "10000",
            currency: "INR",
            lastOccurredAt: DETECTED,
          }
        : extras.payment,
    webhooks:
      extras.webhooks ??
      [
        {
          webhookEventId: SAMPLE_WEBHOOK_ID,
          externalEventId: SAMPLE_EXTERNAL_EVENT_ID,
          eventType: "payment.created",
          occurredAt: DETECTED,
          receivedAt: DETECTED,
          processingStatus: "PROCESSED",
          amountMinor: "10000",
          currency: "INR",
        },
      ],
    retries: extras.retries ?? [],
    audit:
      extras.audit ??
      [
        {
          auditEventId: SAMPLE_AUDIT_ID,
          eventType: "PAYMENT_STATE_CHANGED",
          occurredAt: DETECTED,
          recordedAt: DETECTED,
          previousState: null,
          resultingState: "CREATED",
          reason: "ACCEPTED",
          actor: "PIPELINE",
        },
      ],
    applicableRules: extras.applicableRules ?? applicableRulesFor(exception.exceptionCode),
  };
}

export function validModelResult(context: InvestigationContext) {
  const webhook = context.webhooks[0];
  return {
    summary:
      "Read-only investigation of a deterministic exception. Payment state was not modified.",
    facts: [
      `Exception ${context.exception.exceptionId} is classified as ${context.exception.exceptionCode}.`,
      webhook === undefined
        ? "No webhook row was supplied."
        : `Webhook ${webhook.webhookEventId} is stored as ${webhook.eventType}.`,
    ],
    evidence: [
      {
        sourceType: "EXCEPTION",
        sourceId: context.exception.exceptionId,
        fact: `Deterministic code ${context.exception.exceptionCode} with status ${context.exception.status}.`,
      },
    ],
    likelyCause:
      "The provider may have retried the same event identity with a different payload.",
    recommendedAction: {
      code: "INVESTIGATE_CONFLICTING_PAYLOAD",
      detail: "Compare the authoritative stored event with the rejected delivery. Advisory only.",
    },
    confidence: "MEDIUM",
    limitations: [
      "Confidence describes the explanation, not that money is safe.",
      "Classification remains the deterministic exception engine.",
    ],
  };
}
