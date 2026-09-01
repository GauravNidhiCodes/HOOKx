import { SYNTHETIC_PROVIDER_NAME } from "../synthetic/payload.js";
import { RAZORPAY_PROVIDER_NAME } from "../razorpay/constants.js";
import { RazorpaySignatureVerifier } from "../razorpay/verifier.js";
import type { SignatureVerifier } from "./verifier.js";
import { SyntheticSignatureVerifier } from "./synthetic/verifier.js";

export type SignatureVerifierRegistry = {
  get(provider: string): SignatureVerifier | null;
};

export type SignatureVerifierRegistryOptions = {
  readonly syntheticSecret: string;
  readonly syntheticToleranceSeconds: number;
  readonly razorpayWebhookSecret?: string;
};

/**
 * Provider → verifier. Unknown providers have no verifier and must not be
 * treated as authentic. Razorpay is registered even when the secret is unset
 * so `POST /webhooks/razorpay` fails closed instead of looking unknown.
 */
export function createSignatureVerifierRegistry(
  options: SignatureVerifierRegistryOptions,
): SignatureVerifierRegistry {
  const synthetic = new SyntheticSignatureVerifier({
    secret: options.syntheticSecret,
    toleranceSeconds: options.syntheticToleranceSeconds,
  });
  const razorpay = new RazorpaySignatureVerifier({
    secret: options.razorpayWebhookSecret,
  });

  return {
    get(provider: string): SignatureVerifier | null {
      if (provider === SYNTHETIC_PROVIDER_NAME) {
        return synthetic;
      }
      if (provider === RAZORPAY_PROVIDER_NAME) {
        return razorpay;
      }
      return null;
    },
  };
}
