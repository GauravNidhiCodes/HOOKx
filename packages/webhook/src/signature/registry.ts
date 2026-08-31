import { SYNTHETIC_PROVIDER_NAME } from "../synthetic/payload.js";
import type { SignatureVerifier } from "./verifier.js";
import { SyntheticSignatureVerifier } from "./synthetic/verifier.js";

export type SignatureVerifierRegistry = {
  get(provider: string): SignatureVerifier | null;
};

export type SignatureVerifierRegistryOptions = {
  readonly syntheticSecret: string;
  readonly syntheticToleranceSeconds: number;
};

/**
 * Provider → verifier. Unknown providers have no verifier and must not be
 * treated as authentic. Live PSP verifiers are not registered here yet.
 */
export function createSignatureVerifierRegistry(
  options: SignatureVerifierRegistryOptions,
): SignatureVerifierRegistry {
  const synthetic = new SyntheticSignatureVerifier({
    secret: options.syntheticSecret,
    toleranceSeconds: options.syntheticToleranceSeconds,
  });

  return {
    get(provider: string): SignatureVerifier | null {
      if (provider !== SYNTHETIC_PROVIDER_NAME) {
        return null;
      }
      return synthetic;
    },
  };
}
