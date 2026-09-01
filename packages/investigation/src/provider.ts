/**
 * Vendor-neutral generation surface. Domain code depends on this, not on an
 * SDK. Implementations may call OpenAI, Anthropic, Gemini, or a local stub.
 */
export type StructuredInvestigationRequest = {
  readonly systemPrompt: string;
  readonly untrustedEvidence: string;
};

export interface AIProvider {
  readonly providerId: string;
  readonly modelId: string;
  generateStructuredInvestigation(
    request: StructuredInvestigationRequest,
  ): Promise<string>;
}
