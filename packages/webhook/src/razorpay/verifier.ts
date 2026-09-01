import { providerId, type ProviderId } from "@hookx/domain";
import { signaturesEqual } from "../signature/compare.js";
import { headerValue } from "../signature/headers.js";
import type { SignatureVerificationInput } from "../signature/verifier.js";
import type { SignatureVerifier } from "../signature/verifier.js";
import type { SignatureVerificationResult } from "../signature/result.js";
import { RAZORPAY_PROVIDER_NAME, RAZORPAY_SIGNATURE_HEADER } from "./constants.js";
import {
  computeRazorpaySignatureDigest,
  parseRazorpaySignatureHeader,
} from "./scheme.js";

export type RazorpaySignatureVerifierOptions = {
  readonly secret?: string;
};

/**
 * Razorpay webhook authenticity over the original request bytes.
 *
 * Official procedure (https://razorpay.com/docs/webhooks/validate-test/):
 * expected = HMAC-SHA256(webhook_secret, raw_body) hex
 * compare to header `X-Razorpay-Signature`
 *
 * Secret is injected by the application from `RAZORPAY_WEBHOOK_SECRET`.
 * This class never reads process.env, logs the secret, or returns it.
 */
export class RazorpaySignatureVerifier implements SignatureVerifier {
  public readonly provider: ProviderId = providerId(RAZORPAY_PROVIDER_NAME);
  private readonly secret: string;

  public constructor(options: RazorpaySignatureVerifierOptions = {}) {
    this.secret =
      typeof options.secret === "string" ? options.secret : "";
  }

  public verify(input: SignatureVerificationInput): SignatureVerificationResult {
    const parsed = parseRazorpaySignatureHeader(
      headerValue(input.headers, RAZORPAY_SIGNATURE_HEADER),
    );
    if (!parsed.ok) {
      return parsed.status === "MISSING_SIGNATURE"
        ? {
            status: "MISSING_SIGNATURE",
            reason: "Webhook signature is missing",
          }
        : {
            status: "MALFORMED_SIGNATURE",
            reason: "Webhook signature is malformed",
          };
    }

    if (this.secret.length === 0) {
      return {
        status: "INVALID_SIGNATURE",
        reason: "Webhook signature is invalid",
      };
    }

    const expected = computeRazorpaySignatureDigest(this.secret, input.rawBody);
    if (!signaturesEqual(expected, parsed.digest)) {
      return {
        status: "INVALID_SIGNATURE",
        reason: "Webhook signature is invalid",
      };
    }

    return {
      status: "VERIFIED",
      reason: "Webhook signature is valid",
    };
  }
}
