import {
  DEFAULT_RETRY_LEASE_MS,
  DEFAULT_RETRY_POLICY,
  assertRetryPolicy,
  type RetryPolicy,
} from "@hookx/storage";
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

export type RetryRuntimeConfig = {
  readonly policy: RetryPolicy;
  readonly leaseMs: number;
};

function parseEnvInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || String(parsed) !== raw) {
    throw new Error(`${key} is invalid`);
  }
  return parsed;
}

export function resolveRetryRuntimeConfig(
  env: NodeJS.ProcessEnv,
): RetryRuntimeConfig {
  const policy = assertRetryPolicy({
    maxAttempts: parseEnvInteger(
      env,
      "HOOKX_RETRY_MAX_ATTEMPTS",
      DEFAULT_RETRY_POLICY.maxAttempts,
      1,
    ),
    baseDelayMs: parseEnvInteger(
      env,
      "HOOKX_RETRY_BASE_DELAY_MS",
      DEFAULT_RETRY_POLICY.baseDelayMs,
      0,
    ),
    maxDelayMs: parseEnvInteger(
      env,
      "HOOKX_RETRY_MAX_DELAY_MS",
      DEFAULT_RETRY_POLICY.maxDelayMs,
      0,
    ),
  });
  return Object.freeze({
    policy,
    leaseMs: parseEnvInteger(
      env,
      "HOOKX_RETRY_LEASE_MS",
      DEFAULT_RETRY_LEASE_MS,
      1,
    ),
  });
}
