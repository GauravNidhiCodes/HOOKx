import {
  serializeInvestigationContext,
  type InvestigationContext,
} from "./context.js";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";
import type { Investigator } from "./investigator.js";
import {
  INVESTIGATION_PROMPT_VERSION,
  INVESTIGATION_SYSTEM_PROMPT,
  untrustedEvidenceMessage,
} from "./prompt.js";
import type { InvestigationResult } from "./result.js";
import { parseModelJson, validateInvestigationResult } from "./validate.js";

export type OpenAIInvestigatorConfig = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * Isolated OpenAI-compatible HTTP adapter. The rest of HOOKX depends on
 * Investigator, not on this class. No payment-provider calls, no tools.
 */
export class OpenAIInvestigator implements Investigator {
  public readonly implementation = "openai";
  public readonly modelId: string;
  public readonly promptVersion = INVESTIGATION_PROMPT_VERSION;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(config: OpenAIInvestigatorConfig) {
    if (config.apiKey.length === 0) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.MISSING_API_KEY,
        "HOOKX_OPENAI_API_KEY is not set",
      );
    }
    this.apiKey = config.apiKey;
    this.modelId = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  public async investigate(
    context: InvestigationContext,
  ): Promise<InvestigationResult> {
    const url = `${this.baseUrl}/chat/completions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelId,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: INVESTIGATION_SYSTEM_PROMPT },
            {
              role: "user",
              content: untrustedEvidenceMessage(
                serializeInvestigationContext(context),
              ),
            },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE,
        "AI provider request failed",
      );
    }
    if (!response.ok) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE,
        "AI provider returned an error",
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
        "AI provider response is not JSON",
      );
    }
    const content = readContent(body);
    const parsed = parseModelJson(content);
    return validateInvestigationResult(parsed, context);
  }
}

function readContent(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "AI provider body is invalid",
    );
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices[0] === undefined) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "AI provider returned no choices",
    );
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  if (typeof message?.content !== "string" || message.content.trim().length === 0) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "AI provider returned empty content",
    );
  }
  return message.content;
}
