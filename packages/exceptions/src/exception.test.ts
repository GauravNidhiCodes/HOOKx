import { describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createException, createExceptionDraft } from "./exception.js";
import { canTransitionExceptionStatus } from "./status.js";

const NOW = instant("2026-01-15T10:00:01.000Z");

describe("createException", () => {
  it("freezes the record and derives severity from the code", () => {
    const record = createException({
      exceptionId: "11111111-1111-4111-8111-111111111111",
      exceptionCode: "DUPLICATE_EVENT",
      paymentId: paymentId("SYNTHETIC:pay:1"),
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      provider: providerId("SYNTHETIC"),
      reason: "DUPLICATE_EVENT",
      detectedAt: NOW,
      correlationId: "corr-1",
    });
    expect(record.severity).toBe("INFO");
    expect(record.status).toBe("OPEN");
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as { status: string }).status = "RESOLVED";
    }).toThrow();
  });

  it("strips secret and payload metadata keys", () => {
    const draft = createExceptionDraft({
      exceptionCode: "INVALID_SIGNATURE",
      paymentId: null,
      webhookEventId: null,
      provider: providerId("SYNTHETIC"),
      reason: "INVALID_SIGNATURE",
      detectedAt: NOW,
      correlationId: "corr-1",
      metadata: {
        secret: "dev-only-not-a-real-secret",
        signature: "t=1,v1=abc",
        payload: { amount: 1 },
        eventType: "payment.created",
      },
    });
    expect(draft.metadata).toEqual({ eventType: "payment.created" });
    expect(JSON.stringify(draft)).not.toContain("dev-only-not-a-real-secret");
  });

  it("rejects a severity that does not match the code", () => {
    expect(() =>
      createException({
        exceptionId: "11111111-1111-4111-8111-111111111111",
        exceptionCode: "DUPLICATE_EVENT",
        severity: "CRITICAL",
        paymentId: null,
        webhookEventId: null,
        provider: null,
        reason: "DUPLICATE_EVENT",
        detectedAt: NOW,
        correlationId: "corr-1",
      }),
    ).toThrow(/severity must match/);
  });
});

describe("exception status transitions", () => {
  it("only allows forward lifecycle movement", () => {
    expect(canTransitionExceptionStatus("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionExceptionStatus("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionExceptionStatus("ACKNOWLEDGED", "RESOLVED")).toBe(true);
    expect(canTransitionExceptionStatus("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionExceptionStatus("ACKNOWLEDGED", "OPEN")).toBe(false);
  });
});
