import {
  RetryableProcessingError,
  processPaymentEvents,
  type ProcessPaymentEventsFn,
} from "@hookx/storage";
import type { FailurePlan } from "@hookx/simulator";

/**
 * Deterministic processing failures for simulator demos.
 * Attempt counts are sequential for this function instance. No randomness.
 */
export function createSimulatorProcessFn(
  plan: FailurePlan,
): ProcessPaymentEventsFn {
  let attempts = 0;
  return async (...args) => {
    attempts += 1;
    if (plan.kind === "FAIL_THEN_SUCCEED" && attempts <= plan.failAttempts) {
      throw new RetryableProcessingError();
    }
    if (plan.kind === "EXHAUST_RETRIES") {
      throw new RetryableProcessingError();
    }
    return processPaymentEvents(...args);
  };
}
