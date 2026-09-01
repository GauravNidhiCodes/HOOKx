import { describe, expect, it, expectTypeOf } from "vitest";
import type { Investigator } from "./investigator.js";
import type { InvestigationContext } from "./context.js";
import {
  OpenAIInvestigator,
  createInvestigatorFromEnv,
  INVESTIGATION_ERROR_CODE,
  InvestigationError,
  INVESTIGATION_SYSTEM_PROMPT,
  untrustedEvidenceMessage,
  serializeInvestigationContext,
  missingApiKeyInvestigator,
} from "./index.js";
import { sampleInvestigationContext, validModelResult } from "./sample-context.js";

describe("Investigator read-only surface", () => {
  it("exposes only investigation metadata and investigate()", () => {
    expectTypeOf<keyof Investigator>().toEqualTypeOf<
      "implementation" | "modelId" | "promptVersion" | "investigate"
    >();
  });

  it("does not accept write handles on InvestigationContext", () => {
    expectTypeOf<keyof InvestigationContext>().toEqualTypeOf<
      | "investigatedAt"
      | "correlationId"
      | "exception"
      | "payment"
      | "webhooks"
      | "retries"
      | "audit"
      | "applicableRules"
    >();
  });
});

describe("createInvestigatorFromEnv", () => {
  it("defaults to the stub when no provider is configured", () => {
    const investigator = createInvestigatorFromEnv({});
    expect(investigator.implementation).toBe("stub");
    expect(investigator.modelId).toBeNull();
  });

  it("returns unavailable when OpenAI is selected without an API key", () => {
    const investigator = createInvestigatorFromEnv({
      HOOKX_INVESTIGATION_PROVIDER: "openai",
    });
    expect(investigator.implementation).toBe("unavailable");
    expect(missingApiKeyInvestigator().implementation).toBe("unavailable");
  });

  it("does not embed secrets in configuration or constructor errors", () => {
    const secret = "must-never-appear-in-investigation-errors";
    expect(() =>
      new OpenAIInvestigator({
        apiKey: "",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toThrow(InvestigationError);
    try {
      new OpenAIInvestigator({
        apiKey: "",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(InvestigationError);
      if (error instanceof InvestigationError) {
        expect(error.code).toBe(INVESTIGATION_ERROR_CODE.MISSING_API_KEY);
        expect(error.message).not.toContain(secret);
      }
    }
  });
});

describe("OpenAIInvestigator", () => {
  it("validates structured model output", async () => {
    const context = sampleInvestigationContext();
    const payload = validModelResult(context);
    const investigator = new OpenAIInvestigator({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const result = await investigator.investigate(context);
    expect(result.summary).toBe(payload.summary);
    expect(result.recommendedAction.executable).toBe(false);
  });

  it("separates system instructions from untrusted evidence", async () => {
    const context = sampleInvestigationContext();
    let body: { messages?: Array<{ role: string; content: string }> } = {};
    const investigator = new OpenAIInvestigator({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async (_url, init) => {
        const parsed = JSON.parse(String(init?.body)) as {
          messages?: Array<{ role: string; content: string }>;
          tools?: unknown;
          functions?: unknown;
        };
        body = parsed;
        expect(parsed.tools).toBeUndefined();
        expect(parsed.functions).toBeUndefined();
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(validModelResult(context)),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await investigator.investigate(context);
    expect(body.messages?.[0]?.role).toBe("system");
    expect(body.messages?.[0]?.content).toBe(INVESTIGATION_SYSTEM_PROMPT);
    expect(body.messages?.[0]?.content).not.toContain("UNTRUSTED INVESTIGATION EVIDENCE");
    expect(body.messages?.[1]?.content).toContain("UNTRUSTED INVESTIGATION EVIDENCE");
    expect(body.messages?.[1]?.content).toBe(
      untrustedEvidenceMessage(serializeInvestigationContext(context)),
    );
  });

  it("maps provider HTTP failures to PROVIDER_UNAVAILABLE", async () => {
    const investigator = new OpenAIInvestigator({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    await expect(
      investigator.investigate(sampleInvestigationContext()),
    ).rejects.toMatchObject({
      code: INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE,
    });
  });

  it("maps network failures to PROVIDER_UNAVAILABLE", async () => {
    const investigator = new OpenAIInvestigator({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(
      investigator.investigate(sampleInvestigationContext()),
    ).rejects.toMatchObject({
      code: INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE,
    });
  });

  it("rejects malformed model JSON from the provider", async () => {
    const investigator = new OpenAIInvestigator({
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{not-json" } }],
          }),
          { status: 200 },
        ),
    });
    await expect(
      investigator.investigate(sampleInvestigationContext()),
    ).rejects.toMatchObject({
      code: INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
    });
  });
});
