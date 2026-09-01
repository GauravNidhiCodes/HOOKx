import { describe, expect, it } from "vitest";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";
import { StubInvestigator } from "./stub.js";
import { UnavailableInvestigator } from "./unavailable.js";
import {
  SAMPLE_EXCEPTION_ID,
  SAMPLE_WEBHOOK_ID,
  sampleInvestigationContext,
  validModelResult,
} from "./sample-context.js";
import {
  createInvestigationResult,
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
    ).toThrow(/likelyCause/);
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

describe("UnavailableInvestigator", () => {
  it("returns a controlled result without calling a model", async () => {
    const result = await new UnavailableInvestigator("network down").investigate(
      sampleInvestigationContext(),
    );
    expect(result.confidence).toBe("LOW");
    expect(result.recommendedAction.code).toBe("REQUEST_OPERATOR_REVIEW");
    expect(result.limitations[0]).toBe("network down");
    expect(result.likelyCause).toContain("No hypothesis");
  });
});
