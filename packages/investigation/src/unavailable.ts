import type { InvestigationContext } from "./context.js";
import type { Investigator } from "./investigator.js";
import { INVESTIGATION_PROMPT_VERSION } from "./prompt.js";
import type { InvestigationResult } from "./result.js";
import { validateInvestigationResult } from "./validate.js";

/**
 * Used when an LLM provider was requested but credentials or the network are
 * missing. Still returns a structured, context-bound result so ingest is unaffected.
 */
export class UnavailableInvestigator implements Investigator {
  public readonly implementation = "unavailable";
  public readonly modelId = null;
  public readonly promptVersion = INVESTIGATION_PROMPT_VERSION;

  public constructor(
    private readonly reason: string = "AI provider unavailable",
  ) {}

  public async investigate(
    context: InvestigationContext,
  ): Promise<InvestigationResult> {
    return validateInvestigationResult(
      {
        summary:
          "Investigation is unavailable. Deterministic exception classification and payment state are unchanged.",
        facts: [
          `Exception ${context.exception.exceptionId} remains ${context.exception.exceptionCode}.`,
          "No model explanation was produced.",
        ],
        evidence: [
          {
            sourceType: "EXCEPTION",
            sourceId: context.exception.exceptionId,
            fact: `Stored exception ${context.exception.exceptionCode} is ${context.exception.status} for operator review.`,
          },
        ],
        likelyCause:
          "No hypothesis is offered because an investigator implementation was not available.",
        recommendedAction: {
          code: "REQUEST_OPERATOR_REVIEW",
          detail: "Review the deterministic exception and audit trail without relying on a model.",
        },
        confidence: "LOW",
        limitations: [
          this.reason,
          "Classification remains the deterministic exception engine.",
        ],
      },
      context,
    );
  }
}

export function missingApiKeyInvestigator(): UnavailableInvestigator {
  return new UnavailableInvestigator("HOOKX_OPENAI_API_KEY is not set");
}
