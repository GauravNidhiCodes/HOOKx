import type { Instant, ProviderId } from "@hookx/domain";
import type { SignatureVerificationResult } from "./result.js";

/**
 * Provider-specific authenticity check over the original request bytes.
 *
 * The HTTP layer supplies headers and injected time. This interface does not
 * parse JSON, talk to a database, or read `Date.now()`.
 */
export type SignatureVerificationInput = {
  readonly rawBody: string | Uint8Array;
  readonly headers: ReadonlyMap<string, string>;
  readonly now: Instant;
};

export interface SignatureVerifier {
  readonly provider: ProviderId;
  verify(input: SignatureVerificationInput): SignatureVerificationResult;
}
