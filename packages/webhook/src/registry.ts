import { SYNTHETIC_PROVIDER_NAME } from "./synthetic/payload.js";
import { syntheticProviderAdapter } from "./synthetic/adapter.js";
import { razorpayProviderAdapter } from "./razorpay/adapter.js";
import { RAZORPAY_PROVIDER_NAME } from "./razorpay/constants.js";
import { WebhookError } from "./errors.js";

export type RegisteredProviderAdapter =
  | typeof syntheticProviderAdapter
  | typeof razorpayProviderAdapter;

/**
 * Provider → adapter. Unknown names never reach normalization.
 */
export function getProviderAdapter(provider: string): RegisteredProviderAdapter {
  if (provider === SYNTHETIC_PROVIDER_NAME) {
    return syntheticProviderAdapter;
  }
  if (provider === RAZORPAY_PROVIDER_NAME) {
    return razorpayProviderAdapter;
  }
  throw new WebhookError("UNSUPPORTED_PROVIDER", "Provider is not supported");
}
