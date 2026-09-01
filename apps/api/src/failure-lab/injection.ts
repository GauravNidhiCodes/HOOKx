import {
  RetryableProcessingError,
  isFailureLabPaymentId,
  processPaymentEvents,
  type ProcessPaymentEventsFn,
} from "@hookx/storage";
import type { SyntheticFailureMode } from "./catalog.js";

/**
 * Isolated processing wrapper for Failure Lab runs.
 * Throws only when the payment id is SYNTHETIC:pay:lab-* and the provider is
 * SYNTHETIC or razorpay (adapter lab / golden demo). Live-shaped Razorpay
 * ids and simulator ids are never injected.
 */
export function createLabProcessFn(
  mode: SyntheticFailureMode,
): ProcessPaymentEventsFn {
  let attempts = 0;
  return async (repository, provider, paymentId) => {
    const labTarget =
      isFailureLabPaymentId(paymentId) &&
      (provider === "SYNTHETIC" || provider === "razorpay");
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
