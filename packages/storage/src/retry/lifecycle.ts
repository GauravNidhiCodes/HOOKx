import type { Instant } from "@hookx/domain";
import type { RetryStatus } from "./status.js";

export type RetryLifecycleTransition = {
  readonly webhookEventId: string;
  readonly attempt: number;
  readonly previousStatus: RetryStatus | null;
  readonly newStatus: RetryStatus;
  readonly reason: string;
  readonly timestamp: Instant;
};

export type RetryLifecycleSink = {
  record(transition: RetryLifecycleTransition): void;
};

export function silentRetryLifecycleSink(): RetryLifecycleSink {
  return {
    record(_transition: RetryLifecycleTransition): void {},
  };
}

export function collectingRetryLifecycleSink(
  into: RetryLifecycleTransition[],
): RetryLifecycleSink {
  return {
    record(transition: RetryLifecycleTransition): void {
      into.push(transition);
    },
  };
}
