import {
  RetryableProcessingError,
  isFailureLabPaymentId,
  processPaymentEvents,
  type ProcessPaymentEventsFn,
} from "@hookx/storage";
import type { SyntheticFailureMode } from "./catalog.js";

/**
 * Isolated processing wrapper for Failure Lab runs.
 * Throws only when provider is SYNTHETIC and the payment id is
 * SYNTHETIC:pay:lab-*. Non-synthetic traffic is never injected.
 */
export function createLabProcessFn(
  mode: SyntheticFailureMode,
): ProcessPaymentEventsFn {
  let attempts = 0;
  return async (repository, provider, paymentId) => {
    const labTarget =
      provider === "SYNTHETIC" && isFailureLabPaymentId(paymentId);
    if (!labTarget || mode === "NONE") {
      return processPaymentEvents(repository, provider, paymentId);
    }
    attempts += 1;
    if (mode === "FAIL_ONCE" && attempts === 1) {
      throw new RetryableProcessingError();
    }
    if (mode === "ALWAYS_FAIL") {
      throw new RetryableProcessingError();
    }
    return processPaymentEvents(repository, provider, paymentId);
  };
}
