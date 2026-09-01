import {
  serializeInvestigationContext,
  type InvestigationContext,
} from "./context.js";
import type { Investigator } from "./investigator.js";
import {
  INVESTIGATION_PROMPT_VERSION,
  INVESTIGATION_SYSTEM_PROMPT,
  untrustedEvidenceMessage,
} from "./prompt.js";
import type { InvestigationResult } from "./result.js";
import { parseModelJson, validateInvestigationResult } from "./validate.js";
import type { AIProvider } from "./provider.js";
import {
  OpenAICompatibleProvider,
  type OpenAIInvestigatorConfig,
} from "./openai-provider.js";
import { sanitizeInvestigationContext } from "./sanitize.js";

export type { OpenAIInvestigatorConfig };

/**
 * Investigator that asks an AIProvider for JSON, then schema-validates it.
 * The rest of HOOKX depends on Investigator, not on a vendor SDK.
 */
export class OpenAIInvestigator implements Investigator {
  public readonly implementation = "openai";
  public readonly modelId: string;
  public readonly promptVersion = INVESTIGATION_PROMPT_VERSION;

  private readonly provider: AIProvider;

  public constructor(
    config: OpenAIInvestigatorConfig | { readonly provider: AIProvider },
  ) {
    if ("provider" in config) {
      this.provider = config.provider;
      this.modelId = config.provider.modelId;
      return;
    }
    this.provider = new OpenAICompatibleProvider(config);
    this.modelId = config.model;
  }

  public async investigate(
    context: InvestigationContext,
  ): Promise<InvestigationResult> {
    const sanitized = sanitizeInvestigationContext(context);
    const content = await this.provider.generateStructuredInvestigation({
      systemPrompt: INVESTIGATION_SYSTEM_PROMPT,
      untrustedEvidence: untrustedEvidenceMessage(
        serializeInvestigationContext(sanitized),
      ),
    });
    const parsed = parseModelJson(content);
    return validateInvestigationResult(parsed, sanitized);
  }
}
