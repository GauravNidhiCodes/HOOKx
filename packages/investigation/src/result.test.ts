import { describe, expect, it } from "vitest";
import { instant } from "@hookx/domain";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";
import { StubInvestigator } from "./stub.js";
import { UnavailableInvestigator } from "./unavailable.js";
import {
  SAMPLE_EXCEPTION_ID,
  SAMPLE_WEBHOOK_ID,
  SAMPLE_AUDIT_ID,
  SAMPLE_RETRY_ID,
  sampleInvestigationContext,
  validModelResult,
} from "./sample-context.js";
import {
  createInvestigationResult,
  isForbiddenFinancialAction,
  parseModelJson,
  validateInvestigationResult,
} from "./index.js";

describe("StubInvestigator", () => {
  it("returns a deterministic, context-bound investigation", async () => {
    const context = sampleInvestigationContext();
    const result = await new StubInvestigator().investigate(context);
    expect(result.confidence).toBe("MEDIUM");
    expect(result.recommendedAction.executable).toBe(false);
    expect(result.recommendedAction.code).toBe("INVESTIGATE_CONFLICTING_PAYLOAD");
    expect(
      result.evidence.every(
        (item) =>
          item.sourceId === SAMPLE_EXCEPTION_ID ||
          item.sourceId === SAMPLE_WEBHOOK_ID ||
          context.audit.some((row) => row.auditEventId === item.sourceId),
      ),
    ).toBe(true);
    expect(result.summary).toContain("CONFLICTING_EVENT");
    expect(result.limitations.some((row) => row.includes("does not call an LLM"))).toBe(true);
  });

  it("separates facts from hypotheses", async () => {
    const result = await new StubInvestigator().investigate(
      sampleInvestigationContext(),
    );
    for (const fact of result.facts) {
      expect(fact.toLowerCase()).not.toMatch(/\bmay have\b/);
      expect(fact.toLowerCase()).not.toMatch(/\blikely\b/);
    }
    expect(result.likelyCause.toLowerCase()).toMatch(/\bmay have\b/);
    expect(result.rootCause).toBe(result.likelyCause);
    expect(result.incidentType).toBe("CONFLICTING_EVENT");
    expect(result.impact.length).toBeGreaterThan(0);
    expect(result.recommendedActions[0]?.code).toBe("INVESTIGATE_CONFLICTING_PAYLOAD");
    expect(result.confidenceReason.length).toBeGreaterThan(0);
  });
});

describe("structured investigation result", () => {
  it("accepts a valid model object bound to the context", () => {
    const context = sampleInvestigationContext();
    const result = validateInvestigationResult(validModelResult(context), context);
    expect(result.evidence[0]?.sourceType).toBe("EXCEPTION");
    expect(result.recommendedAction.executable).toBe(false);
  });

  it("forces recommendedAction.executable to false even if the model sets it", () => {
    const context = sampleInvestigationContext();
    const result = createInvestigationResult({
      ...validModelResult(context),
      recommendedAction: {
        code: "REQUEST_OPERATOR_REVIEW",
        detail: "Ask an operator to review the exception.",
        executable: true,
      },
    });
    expect(result.recommendedAction.executable).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseModelJson("{not-json")).toThrow(InvestigationError);
    try {
      parseModelJson("{not-json");
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT);
      }
    }
  });

  it("rejects missing required fields", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      validateInvestigationResult({ summary: "incomplete" }, context),
    ).toThrow(/rootCause/);
  });

  it("rejects an evidence sourceId that is not in the context", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      validateInvestigationResult(
        {
          ...validModelResult(context),
          evidence: [
            {
              sourceType: "WEBHOOK_EVENT",
              sourceId: "99999999-9999-4999-8999-999999999999",
              fact: "Invented webhook row.",
            },
          ],
        },
        context,
      ),
    ).toThrow(InvestigationError);
    try {
      validateInvestigationResult(
        {
          ...validModelResult(context),
          evidence: [
            {
              sourceType: "WEBHOOK_EVENT",
              sourceId: "99999999-9999-4999-8999-999999999999",
              fact: "Invented webhook row.",
            },
          ],
        },
        context,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.INVALID_EVIDENCE);
      }
    }
  });

  it("rejects hallucinated identifiers in prose", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      validateInvestigationResult(
        {
          ...validModelResult(context),
          summary: `Saw event 99999999-9999-4999-8999-999999999999 which is not in context.`,
        },
        context,
      ),
    ).toThrow(InvestigationError);
    try {
      validateInvestigationResult(
        {
          ...validModelResult(context),
          likelyCause: "Provider responded with SYNTHETIC:evt:hallucinated.",
        },
        context,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE);
      }
    }
  });

  it("rejects unsupported confidence values including percentages", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      validateInvestigationResult(
        { ...validModelResult(context), confidence: "87%" },
        context,
      ),
    ).toThrow(InvestigationError);
    try {
      validateInvestigationResult(
        { ...validModelResult(context), confidence: "87%" },
        context,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.INVALID_CONFIDENCE);
      }
    }
  });

  it("rejects forbidden financial recommendations", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      validateInvestigationResult(
        {
          ...validModelResult(context),
          recommendedAction: {
            code: "REQUEST_OPERATOR_REVIEW",
            detail: "Please capture payment immediately.",
          },
        },
        context,
      ),
    ).toThrow(InvestigationError);
    try {
      createInvestigationResult({
        ...validModelResult(context),
        recommendedAction: { code: "CAPTURE_PAYMENT", detail: "Take funds." },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION);
      }
    }
  });
});

describe("financial mutation guard", () => {
  it("flags capture/refund language and leaves advisory codes unmarked", () => {
    expect(isForbiddenFinancialAction("Please capture payment immediately.")).toBe(
      true,
    );
    expect(isForbiddenFinancialAction("Do not refund payment from this tool.")).toBe(
      true,
    );
    expect(isForbiddenFinancialAction("REQUEST_OPERATOR_REVIEW")).toBe(false);
  });
});

describe("UnavailableInvestigator", () => {
  it("returns a controlled result without calling a model", async () => {
    const result = await new UnavailableInvestigator("network down").investigate(
      sampleInvestigationContext(),
    );
    expect(result.confidence).toBe("LOW");
    expect(result.recommendedAction.code).toBe("REQUEST_OPERATOR_REVIEW");
    expect(result.limitations[0]).toBe("network down");
    expect(result.likelyCause).toContain("No hypothesis");
    expect(result.summary).toContain("INVESTIGATION UNAVAILABLE");
  });
});

describe("insufficient evidence", () => {
  it("does not invent a root cause when history is missing", async () => {
    const context = sampleInvestigationContext({
      payment: null,
      webhooks: [],
      retries: [],
      audit: [],
    });
    const result = await new StubInvestigator().investigate(context);
    expect(result.rootCause).toBe("INSUFFICIENT EVIDENCE");
    expect(result.incidentType).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.confidence).toBe("LOW");
    expect(
      result.limitations.some((row) =>
        row.includes("The available event history does not establish the cause"),
      ),
    ).toBe(true);
  });

  it("rejects a model that invents a cause without evidence", () => {
    const context = sampleInvestigationContext({
      payment: null,
      webhooks: [],
      retries: [],
      audit: [],
    });
    expect(() =>
      validateInvestigationResult(
        {
          ...validModelResult(context),
          incidentType: "DUPLICATE_DELIVERY",
          rootCause: "Duplicate delivery.",
          likelyCause: "Duplicate delivery.",
        },
        context,
      ),
    ).toThrow(InvestigationError);
  });
});

describe("evidence-bound scenario investigations", () => {
  it("explains duplicate delivery from supplied audit and webhook rows", async () => {
    const base = sampleInvestigationContext();
    const context = sampleInvestigationContext({
      exception: {
        ...base.exception,
        exceptionCode: "DUPLICATE_EVENT",
        severity: "INFO",
        reason: "DUPLICATE_EVENT",
      },
      audit: [
        {
          auditEventId: SAMPLE_AUDIT_ID,
          eventType: "WEBHOOK_DUPLICATE",
          occurredAt: base.investigatedAt,
          recordedAt: base.investigatedAt,
          previousState: "CREATED",
          resultingState: "CREATED",
          reason: "DUPLICATE_EVENT",
          actor: "SYSTEM",
        },
        ...base.audit,
      ],
    });
    const result = await new StubInvestigator().investigate(context);
    expect(result.incidentType).toBe("DUPLICATE_DELIVERY");
    expect(result.confidence).toBe("HIGH");
    expect(result.impact.toLowerCase()).toMatch(/transition/);
    expect(result.evidence.some((item) => item.sourceType === "WEBHOOK_EVENT")).toBe(
      true,
    );
    expect(result.summary).not.toContain("customer lost money");
  });

  it("explains retry exhaustion from dead-letter evidence", async () => {
    const base = sampleInvestigationContext();
    const context = sampleInvestigationContext({
      exception: {
        ...base.exception,
        exceptionCode: "RETRY_EXHAUSTED",
        severity: "CRITICAL",
        reason: "RETRY_EXHAUSTED",
      },
      retries: [
        {
          retryId: SAMPLE_RETRY_ID,
          webhookEventId: SAMPLE_WEBHOOK_ID,
          attemptCount: 5,
          status: "DEAD_LETTERED",
          lastErrorCode: "TEMPORARY_PROCESSING_FAILURE",
          lastFailedAt: base.investigatedAt,
          deadLettered: true,
        },
      ],
      audit: [
        {
          auditEventId: SAMPLE_AUDIT_ID,
          eventType: "RETRY_DEAD_LETTERED",
          occurredAt: base.investigatedAt,
          recordedAt: base.investigatedAt,
          previousState: null,
          resultingState: null,
          reason: "RETRY_EXHAUSTED",
          actor: "RETRY_WORKER",
        },
      ],
    });
    const result = await new StubInvestigator().investigate(context);
    expect(result.incidentType).toBe("RETRY_EXHAUSTION");
    expect(result.confidence).toBe("HIGH");
    expect(result.impact.toLowerCase()).toMatch(/dead-letter/);
  });

  it("explains replay/out-of-order from delivery vs event-time order", async () => {
    const second = "66666666-6666-4666-8666-666666666666";
    const context = sampleInvestigationContext({
      exception: {
        ...sampleInvestigationContext().exception,
        exceptionCode: "OUT_OF_ORDER_EVENT",
        severity: "WARNING",
        reason: "OUT_OF_ORDER_EVENT",
      },
      webhooks: [
        {
          webhookEventId: SAMPLE_WEBHOOK_ID,
          externalEventId: "SYNTHETIC:evt:late",
          eventType: "payment.captured",
          occurredAt: instant("2026-01-15T10:00:02.000Z"),
          receivedAt: instant("2026-01-15T10:00:00.000Z"),
          processingStatus: "PROCESSED",
          amountMinor: "10000",
          currency: "INR",
        },
        {
          webhookEventId: second,
          externalEventId: "SYNTHETIC:evt:early",
          eventType: "payment.created",
          occurredAt: instant("2026-01-15T10:00:00.000Z"),
          receivedAt: instant("2026-01-15T10:00:01.000Z"),
          processingStatus: "PROCESSED",
          amountMinor: "10000",
          currency: "INR",
        },
      ],
      audit: [
        {
          auditEventId: SAMPLE_AUDIT_ID,
          eventType: "WEBHOOK_DELAYED",
          occurredAt: instant("2026-01-15T10:00:00.000Z"),
          recordedAt: instant("2026-01-15T10:00:00.000Z"),
          previousState: null,
          resultingState: null,
          reason: "OUT_OF_ORDER",
          actor: "SYSTEM",
        },
      ],
    });
    const result = await new StubInvestigator().investigate(context);
    expect(result.incidentType).toBe("OUT_OF_ORDER_EVENT");
    expect(result.confidence).toBe("HIGH");
    expect(context.replay.orderingMismatch).toBe(true);
  });
});

describe("unsupported financial claims", () => {
  it("rejects inferred customer loss", () => {
    const context = sampleInvestigationContext();
    expect(() =>
      createInvestigationResult({
        ...validModelResult(context),
        impact: "The customer lost money because the webhook failed.",
      }),
    ).toThrow(InvestigationError);
  });
});
