import type { Investigator } from "./investigator.js";
import { OpenAIInvestigator } from "./openai.js";
import { StubInvestigator } from "./stub.js";
import { UnavailableInvestigator } from "./unavailable.js";

export const INVESTIGATION_PROVIDERS = ["stub", "openai"] as const;

export type InvestigationProvider = (typeof INVESTIGATION_PROVIDERS)[number];

export type InvestigationRuntimeConfig = {
  readonly provider: InvestigationProvider;
  readonly openaiApiKey: string | null;
  readonly openaiModel: string;
  readonly openaiBaseUrl: string;
};

export function resolveInvestigationRuntimeConfig(
  env: NodeJS.ProcessEnv,
): InvestigationRuntimeConfig {
  const raw = env["HOOKX_INVESTIGATION_PROVIDER"]?.trim().toLowerCase();
  const provider: InvestigationProvider =
    raw === "openai" ? "openai" : "stub";
  const openaiApiKey = env["HOOKX_OPENAI_API_KEY"]?.trim() ?? "";
  return Object.freeze({
    provider,
    openaiApiKey: openaiApiKey.length === 0 ? null : openaiApiKey,
    openaiModel: env["HOOKX_OPENAI_MODEL"]?.trim() || "gpt-4o-mini",
    openaiBaseUrl:
      env["HOOKX_OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1",
  });
}

/**
 * Application wiring. Defaults to StubInvestigator so webhook ingest never
 * depends on an LLM. OpenAI without a key becomes UnavailableInvestigator.
 */
export function createInvestigatorFromEnv(
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): Investigator {
  const config = resolveInvestigationRuntimeConfig(env);
  if (config.provider !== "openai") {
    return new StubInvestigator();
  }
  if (config.openaiApiKey === null) {
    return new UnavailableInvestigator("HOOKX_OPENAI_API_KEY is not set");
  }
  return new OpenAIInvestigator({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    baseUrl: config.openaiBaseUrl,
    fetchImpl,
  });
}
