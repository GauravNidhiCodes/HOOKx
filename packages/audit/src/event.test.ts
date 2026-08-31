import { describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createAuditEvent, draftAuditEvent } from "./event.js";
import { AUDIT_REASON } from "./reason.js";

const OCCURRED = instant("2026-01-15T10:00:00.000Z");
const RECORDED = instant("2026-01-15T10:00:01.000Z");

describe("createAuditEvent", () => {
  it("creates an immutable payment-state audit event", () => {
    const event = createAuditEvent({
      auditEventId: "11111111-1111-4111-8111-111111111111",
      eventType: "PAYMENT_STATE_CHANGED",
      occurredAt: OCCURRED,
      recordedAt: RECORDED,
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:1"),
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      previousState: "CREATED",
      resultingState: "AUTHORIZED",
      actor: "SYSTEM",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "req-1",
      metadata: { attempt: 1 },
    });
    expect(event.previousState).toBe("CREATED");
    expect(event.resultingState).toBe("AUTHORIZED");
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.recordedAt).toBe(RECORDED);
    expect(event.occurredAt).not.toBe(event.recordedAt);
    expect(Object.isFrozen(event)).toBe(true);
    expect(() => {
      (event as { reason: string }).reason = "MUTATED";
    }).toThrow();
  });

  it("keeps resultingState unchanged for a rejected transition", () => {
    const event = createAuditEvent({
      auditEventId: "11111111-1111-4111-8111-111111111111",
      eventType: "PAYMENT_STATE_CHANGED",
      occurredAt: OCCURRED,
      recordedAt: RECORDED,
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:1"),
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      previousState: "CREATED",
      resultingState: "CREATED",
      actor: "SYSTEM",
      reason: AUDIT_REASON.INVALID_TRANSITION,
      correlationId: "req-reject",
    });
    expect(event.previousState).toBe(event.resultingState);
    expect(event.reason).toBe("INVALID_TRANSITION");
  });

  it("rejects unknown event types and free-form reason stacks", () => {
    expect(() =>
      createAuditEvent({
        auditEventId: "11111111-1111-4111-8111-111111111111",
        eventType: "NOT_A_REAL_EVENT" as "WEBHOOK_RECEIVED",
        occurredAt: OCCURRED,
        recordedAt: RECORDED,
        provider: null,
        paymentId: null,
        webhookEventId: null,
        previousState: null,
        resultingState: null,
        actor: "SYSTEM",
        reason: "ACCEPTED",
        correlationId: "req-1",
      }),
    ).toThrow(/Unknown audit event type/);
    const sanitized = createAuditEvent({
      auditEventId: "11111111-1111-4111-8111-111111111111",
      eventType: "WEBHOOK_REJECTED",
      occurredAt: OCCURRED,
      recordedAt: RECORDED,
      provider: providerId("SYNTHETIC"),
      paymentId: null,
      webhookEventId: null,
      previousState: null,
      resultingState: null,
      actor: "SYSTEM",
      reason: "Error: boom\n    at secret.js:1",
      correlationId: "req-1",
    });
    expect(sanitized.reason).toBe(AUDIT_REASON.TEMPORARY_PROCESSING_FAILURE);
  });

  it("strips secrets, signatures, and payload-like metadata", () => {
    const event = createAuditEvent({
      auditEventId: "11111111-1111-4111-8111-111111111111",
      eventType: "WEBHOOK_RECEIVED",
      occurredAt: OCCURRED,
      recordedAt: RECORDED,
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:1"),
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      previousState: null,
      resultingState: null,
      actor: "WEBHOOK_PROVIDER",
      reason: AUDIT_REASON.ACCEPTED,
      correlationId: "req-1",
      metadata: {
        secret: "dev-only-not-a-real-secret",
        signature: "t=1,v1=abc",
        authorization: "Bearer xyz",
        payload: { amount: 1 },
        eventType: "payment.created",
        attempt: 1,
      },
    });
    expect(event.metadata).toEqual({ eventType: "payment.created", attempt: 1 });
    expect(JSON.stringify(event)).not.toContain("dev-only-not-a-real-secret");
    expect(JSON.stringify(event)).not.toContain("Bearer");
  });
});

describe("draftAuditEvent", () => {
  it("validates a draft without exposing the placeholder id to callers", () => {
    const draft = draftAuditEvent({
      eventType: "RETRY_SCHEDULED",
      occurredAt: OCCURRED,
      recordedAt: RECORDED,
      provider: providerId("SYNTHETIC"),
      paymentId: paymentId("SYNTHETIC:pay:1"),
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      previousState: null,
      resultingState: null,
      actor: "SYSTEM",
      reason: AUDIT_REASON.TEMPORARY_PROCESSING_FAILURE,
      correlationId: "req-1",
      metadata: { attempt: 1 },
    });
    expect(draft.eventType).toBe("RETRY_SCHEDULED");
    expect(draft).not.toHaveProperty("auditEventId");
  });
});
