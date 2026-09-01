import { describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import {
  detectException,
  EXCEPTION_PRECEDENCE,
  EXCEPTION_SEVERITY_BY_CODE,
  exceptionIdentity,
  factsFromFailureCode,
  factsFromReplayDecision,
  factsFromRetryOutcome,
  factsFromStoreOutcome,
  factsFromVerificationStatus,
  factsFromWebhookErrorCode,
  uniqueMissingPrerequisite,
  type DetectionContext,
  type DetectionFact,
} from "./index.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const PAYMENT = paymentId("SYNTHETIC:pay:ex-1");
const PROVIDER = providerId("SYNTHETIC");
const WEBHOOK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function context(
  facts: readonly DetectionFact[],
  extras: Partial<DetectionContext> = {},
): DetectionContext {
  return {
    detectedAt: NOW,
    correlationId: "corr-1",
    provider: PROVIDER,
    paymentId: PAYMENT,
    webhookEventId: WEBHOOK,
    facts,
    ...extras,
  };
}

function codesOf(facts: readonly DetectionFact[]) {
  return detectException(context(facts)).exceptions.map(
    (row) => row.exceptionCode,
  );
}

describe("detectException", () => {
  it("classifies a duplicate event as DUPLICATE_EVENT without implying a transition", () => {
    const result = detectException(
      context(factsFromStoreOutcome("DUPLICATE")),
    );
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]?.exceptionCode).toBe("DUPLICATE_EVENT");
    expect(result.exceptions[0]?.severity).toBe("INFO");
    expect(result.exceptions[0]?.status).toBe("OPEN");
    expect(result.exceptions[0]?.reason).toBe("DUPLICATE_EVENT");
  });

  it("classifies identity-hash conflict as CONFLICTING_EVENT and keeps original authoritative", () => {
    const result = detectException(context(factsFromStoreOutcome("CONFLICT")));
    expect(result.exceptions[0]?.exceptionCode).toBe("CONFLICTING_EVENT");
    expect(result.exceptions[0]?.severity).toBe("ERROR");
    expect(result.exceptions[0]?.metadata["originalAuthoritative"]).toBe(true);
  });

  it("classifies invalid, missing, and expired signatures as INVALID_SIGNATURE", () => {
    for (const status of [
      "INVALID_SIGNATURE",
      "MISSING_SIGNATURE",
      "EXPIRED_SIGNATURE",
    ] as const) {
      const result = detectException(
        context(factsFromVerificationStatus(status), {
          paymentId: null,
          webhookEventId: null,
        }),
      );
      expect(result.exceptions[0]?.exceptionCode).toBe("INVALID_SIGNATURE");
      expect(result.exceptions[0]?.severity).toBe("ERROR");
      expect(result.exceptions[0]?.reason).toBe(status);
      expect(result.exceptions[0]?.webhookEventId).toBeNull();
    }
  });

  it("classifies malformed signature and invalid payload as MALFORMED_WEBHOOK", () => {
    expect(codesOf(factsFromVerificationStatus("MALFORMED_SIGNATURE"))).toEqual([
      "MALFORMED_WEBHOOK",
    ]);
    expect(codesOf(factsFromWebhookErrorCode("INVALID_PAYLOAD"))).toEqual([
      "MALFORMED_WEBHOOK",
    ]);
    expect(codesOf(factsFromWebhookErrorCode("INVALID_AMOUNT"))).toEqual([
      "MALFORMED_WEBHOOK",
    ]);
  });

  it("classifies unsupported provider and event as UNSUPPORTED_EVENT", () => {
    expect(codesOf(factsFromVerificationStatus("UNSUPPORTED_PROVIDER"))).toEqual([
      "UNSUPPORTED_EVENT",
    ]);
    expect(codesOf(factsFromWebhookErrorCode("UNSUPPORTED_EVENT"))).toEqual([
      "UNSUPPORTED_EVENT",
    ]);
    expect(
      detectException(context(factsFromWebhookErrorCode("UNSUPPORTED_EVENT")))
        .exceptions[0]?.severity,
    ).toBe("WARNING");
  });

  it("classifies delayed capture as OUT_OF_ORDER_EVENT", () => {
    const result = detectException(
      context(
        factsFromReplayDecision({
          decision: "DELAYED",
          reason: "AWAITING_PREREQUISITE",
          previousState: "CREATED",
          eventType: "payment.captured",
        }),
      ),
    );
    const codes = result.exceptions.map((row) => row.exceptionCode);
    expect(codes).toContain("OUT_OF_ORDER_EVENT");
    const delayed = result.exceptions.find(
      (row) => row.exceptionCode === "OUT_OF_ORDER_EVENT",
    );
    expect(delayed?.severity).toBe("WARNING");
    expect(delayed?.metadata["previousState"]).toBe("CREATED");
    expect(delayed?.metadata["eventType"]).toBe("payment.captured");
    expect(delayed?.reason).toBe("AWAITING_PREREQUISITE");
  });

  it("classifies an invalid state transition and captures previous state, type, and reason", () => {
    const result = detectException(
      context(
        factsFromReplayDecision({
          decision: "CONFLICT",
          reason: "IMPOSSIBLE_AFTER_ORDERING",
          previousState: "CREATED",
          eventType: "payment.created",
        }),
      ),
    );
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]?.exceptionCode).toBe("INVALID_STATE_TRANSITION");
    expect(result.exceptions[0]?.severity).toBe("ERROR");
    expect(result.exceptions[0]?.metadata["previousState"]).toBe("CREATED");
    expect(result.exceptions[0]?.metadata["eventType"]).toBe("payment.created");
    expect(result.exceptions[0]?.metadata["reasonCode"]).toBe(
      "IMPOSSIBLE_AFTER_ORDERING",
    );
  });

  it("classifies retry exhaustion as CRITICAL RETRY_EXHAUSTED", () => {
    const result = detectException(
      context(
        factsFromRetryOutcome({
          status: "DEAD_LETTERED",
          attemptCount: 2,
          maxAttempts: 2,
          failureCode: "TEMPORARY_UNAVAILABLE",
          exhaustedByAttempts: true,
        }),
      ),
    );
    expect(result.exceptions.map((row) => row.exceptionCode)).toEqual([
      "RETRY_EXHAUSTED",
    ]);
    expect(result.exceptions[0]?.severity).toBe("CRITICAL");
    expect(result.exceptions[0]?.reason).toBe("MAX_RETRIES_EXCEEDED");
    expect(result.exceptions[0]?.metadata["attempt"]).toBe(2);
  });

  it("classifies a scheduled retry as PROCESSING_FAILURE", () => {
    const result = detectException(
      context(
        factsFromRetryOutcome({
          status: "RETRY_SCHEDULED",
          attemptCount: 1,
          maxAttempts: 5,
          failureCode: "TEMPORARY_UNAVAILABLE",
        }),
      ),
    );
    expect(result.exceptions[0]?.exceptionCode).toBe("PROCESSING_FAILURE");
    expect(result.exceptions[0]?.severity).toBe("ERROR");
    expect(result.exceptions[0]?.reason).toBe("TEMPORARY_UNAVAILABLE");
  });

  it("detects MISSING_EVENT only when the transition table names a unique predecessor", () => {
    expect(uniqueMissingPrerequisite("CREATED", "payment.captured")).toBe(
      "payment.authorized",
    );
    const result = detectException(
      context(
        factsFromReplayDecision({
          decision: "DELAYED",
          reason: "AWAITING_PREREQUISITE",
          previousState: "CREATED",
          eventType: "payment.captured",
        }),
      ),
    );
    expect(result.exceptions.map((row) => row.exceptionCode)).toEqual([
      "OUT_OF_ORDER_EVENT",
      "MISSING_EVENT",
    ]);
    const missing = result.exceptions.find(
      (row) => row.exceptionCode === "MISSING_EVENT",
    );
    expect(missing?.severity).toBe("WARNING");
    expect(missing?.metadata["missingEventType"]).toBe("payment.authorized");
    expect(missing?.metadata["delayedEventType"]).toBe("payment.captured");
  });

  it("does not invent a missing event when the current state already accepts the type", () => {
    expect(uniqueMissingPrerequisite("AUTHORIZED", "payment.captured")).toBeNull();
  });

  it("assigns severity solely from the exception code", () => {
    expect(EXCEPTION_SEVERITY_BY_CODE.DUPLICATE_EVENT).toBe("INFO");
    expect(EXCEPTION_SEVERITY_BY_CODE.OUT_OF_ORDER_EVENT).toBe("WARNING");
    expect(EXCEPTION_SEVERITY_BY_CODE.CONFLICTING_EVENT).toBe("ERROR");
    expect(EXCEPTION_SEVERITY_BY_CODE.RETRY_EXHAUSTED).toBe("CRITICAL");
  });

  it("orders multiple independent exceptions by documented precedence", () => {
    const result = detectException(
      context([
        { kind: "DUPLICATE_EVENT" },
        { kind: "CONFLICTING_EVENT" },
        {
          kind: "RETRY_EXHAUSTED",
          failureCode: "TEMPORARY_UNAVAILABLE",
          attemptCount: 5,
        },
        { kind: "INVALID_SIGNATURE", reason: "INVALID_SIGNATURE" },
      ]),
    );
    expect(result.exceptions.map((row) => row.exceptionCode)).toEqual([
      "INVALID_SIGNATURE",
      "CONFLICTING_EVENT",
      "RETRY_EXHAUSTED",
      "DUPLICATE_EVENT",
    ]);
    expect(EXCEPTION_PRECEDENCE[0]).toBe("INVALID_SIGNATURE");
    expect(EXCEPTION_PRECEDENCE[EXCEPTION_PRECEDENCE.length - 1]).toBe(
      "DUPLICATE_EVENT",
    );
  });

  it("uses a stable identity so the same condition does not mint a new logical incident", () => {
    const first = detectException(context([{ kind: "DUPLICATE_EVENT" }]));
    const second = detectException(context([{ kind: "DUPLICATE_EVENT" }]));
    expect(first.exceptions[0]?.identity).toBe(second.exceptions[0]?.identity);
    expect(first.exceptions[0]?.identity).toBe(
      exceptionIdentity({
        exceptionCode: "DUPLICATE_EVENT",
        paymentId: PAYMENT,
        webhookEventId: WEBHOOK,
        correlationId: "corr-1",
      }),
    );
  });

  it("does not collapse unrelated incidents that share a provider", () => {
    const stored = detectException(context([{ kind: "DUPLICATE_EVENT" }]));
    const unsigned = detectException(
      context([{ kind: "INVALID_SIGNATURE", reason: "INVALID_SIGNATURE" }], {
        webhookEventId: null,
        paymentId: null,
        correlationId: "corr-other",
      }),
    );
    expect(stored.exceptions[0]?.identity).not.toBe(
      unsigned.exceptions[0]?.identity,
    );
    const otherUnsigned = detectException(
      context([{ kind: "INVALID_SIGNATURE", reason: "INVALID_SIGNATURE" }], {
        webhookEventId: null,
        paymentId: null,
        correlationId: "corr-third",
      }),
    );
    expect(unsigned.exceptions[0]?.identity).not.toBe(
      otherUnsigned.exceptions[0]?.identity,
    );
  });

  it("preserves independent codes rather than overwriting with the highest severity", () => {
    const result = detectException(
      context([
        {
          kind: "PROCESSING_FAILURE",
          failureCode: "TEMPORARY_UNAVAILABLE",
          attemptCount: 1,
        },
        {
          kind: "RETRY_EXHAUSTED",
          failureCode: "TEMPORARY_UNAVAILABLE",
          attemptCount: 2,
        },
      ]),
    );
    expect(result.exceptions.map((row) => row.exceptionCode)).toEqual([
      "PROCESSING_FAILURE",
      "RETRY_EXHAUSTED",
    ]);
  });

  it("is deterministic: same facts yield the same drafts", () => {
    const facts: DetectionFact[] = [
      {
        kind: "OUT_OF_ORDER_EVENT",
        previousState: "CREATED",
        eventType: "payment.captured",
        reason: "AWAITING_PREREQUISITE",
      },
    ];
    const a = detectException(context(facts));
    const b = detectException(context(facts));
    expect(a).toEqual(b);
    expect(Object.isFrozen(a.exceptions)).toBe(true);
    expect(Object.isFrozen(a.exceptions[0])).toBe(true);
  });

  it("does not put payload-like keys into metadata", () => {
    const result = detectException(
      context(factsFromStoreOutcome("CONFLICT")),
    );
    expect(JSON.stringify(result.exceptions[0]?.metadata)).not.toMatch(
      /secret|signature|payload/i,
    );
  });

  it("does not emit RETRY_EXHAUSTED for a first-attempt permanent failure", () => {
    const result = detectException(
      context(
        factsFromRetryOutcome({
          status: "DEAD_LETTERED",
          attemptCount: 1,
          maxAttempts: 5,
          failureCode: "INVALID_TRANSITION",
          exhaustedByAttempts: false,
        }),
      ),
    );
    expect(result.exceptions.map((row) => row.exceptionCode)).toEqual([
      "INVALID_STATE_TRANSITION",
    ]);
  });

  it("maps replay MATERIAL_CONFLICT to CONFLICTING_EVENT, not invalid transition", () => {
    expect(
      codesOf(
        factsFromReplayDecision({
          decision: "CONFLICT",
          reason: "MATERIAL_CONFLICT",
          previousState: "CREATED",
          eventType: "payment.authorized",
        }),
      ),
    ).toEqual(["CONFLICTING_EVENT"]);
  });

  it("maps thrown invalid-transition failure codes without a fake event type", () => {
    const result = detectException(
      context(factsFromFailureCode("INVALID_TRANSITION")),
    );
    expect(result.exceptions[0]?.exceptionCode).toBe("INVALID_STATE_TRANSITION");
    expect(result.exceptions[0]?.metadata["eventType"]).toBeUndefined();
  });

  it("uses correlation id in identity when no webhook row exists", () => {
    const result = detectException(
      context(factsFromVerificationStatus("INVALID_SIGNATURE"), {
        webhookEventId: null,
        paymentId: null,
      }),
    );
    expect(result.exceptions[0]?.identity).toBe(
      "INVALID_SIGNATURE|||corr-1",
    );
  });
});
