export const RETRY_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "RETRY_SCHEDULED",
  "DEAD_LETTERED",
] as const;

export type RetryStatus = (typeof RETRY_STATUSES)[number];

export function isRetryStatus(value: string): value is RetryStatus {
  return (RETRY_STATUSES as readonly string[]).includes(value);
}
