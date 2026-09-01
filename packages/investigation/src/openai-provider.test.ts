import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_ERROR_CODE,
  InvestigationError,
  OpenAICompatibleProvider,
} from "./index.js";

const REQUEST = {
  systemPrompt: "system",
  untrustedEvidence: '{"exceptionId":"x"}',
};

describe("OpenAICompatibleProvider failure isolation", () => {
  it("maps a timed-out fetch to PROVIDER_UNAVAILABLE", async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-test",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1,
      fetchImpl: async () => {
        throw new Error("The operation was aborted");
      },
    });
    try {
      await provider.generateStructuredInvestigation(REQUEST);
      throw new Error("expected PROVIDER_UNAVAILABLE");
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE);
      }
    }
  });

  it("maps malformed and incomplete model HTTP bodies to MALFORMED_MODEL_OUTPUT", async () => {
    const malformed = new OpenAICompatibleProvider({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-test",
      baseUrl: "https://example.invalid/v1",
      fetchImpl: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    try {
      await malformed.generateStructuredInvestigation(REQUEST);
      throw new Error("expected MALFORMED_MODEL_OUTPUT");
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT);
      }
    }

    const incomplete = new OpenAICompatibleProvider({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-test",
      baseUrl: "https://example.invalid/v1",
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    try {
      await incomplete.generateStructuredInvestigation(REQUEST);
      throw new Error("expected MALFORMED_MODEL_OUTPUT");
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT);
      }
    }
  });
});
