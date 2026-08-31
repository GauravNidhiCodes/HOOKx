import {
  DEFAULT_SYNTHETIC_TOLERANCE_SECONDS,
} from "@hookx/webhook";

export function resolveSyntheticWebhookSecret(env: NodeJS.ProcessEnv): string {
  const value = env["HOOKX_SYNTHETIC_WEBHOOK_SECRET"];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("HOOKX_SYNTHETIC_WEBHOOK_SECRET is not set");
  }
  return value;
}

export function resolveSyntheticWebhookToleranceSeconds(
  env: NodeJS.ProcessEnv,
): number {
  const raw = env["HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS"];
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_SYNTHETIC_TOLERANCE_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== raw) {
    throw new Error("HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS is invalid");
  }
  return parsed;
}
