export type RetryPolicy = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
});

export const DEFAULT_RETRY_LEASE_MS = 30_000;

export function assertRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    !Number.isInteger(policy.baseDelayMs) ||
    policy.baseDelayMs < 0 ||
    !Number.isInteger(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs
  ) {
    throw new Error("Retry policy is invalid");
  }
  return policy;
}

/**
 * Delay after a failed attempt before the next try.
 * `attempt` is the 1-based count of failures so far.
 * delay = min(maxDelayMs, baseDelayMs * 2^(attempt-1))
 *
 * Pure: no clock, no randomness, no I/O.
 */
export function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy,
): number {
  assertRetryPolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Retry attempt must be a positive integer");
  }
  if (attempt > 30) {
    return policy.maxDelayMs;
  }
  const delay = policy.baseDelayMs * 2 ** (attempt - 1);
  if (!Number.isFinite(delay) || delay >= policy.maxDelayMs) {
    return policy.maxDelayMs;
  }
  return delay;
}
