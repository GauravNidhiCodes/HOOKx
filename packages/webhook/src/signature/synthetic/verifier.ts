import { providerId, type ProviderId } from "@hookx/domain";
import { signaturesEqual } from "../compare.js";
import { headerValue, toRawBodyBytes } from "../headers.js";
import { unixSecondsFromInstant } from "../unix-time.js";
import type { SignatureVerificationInput } from "../verifier.js";
import type { SignatureVerifier } from "../verifier.js";
import type { SignatureVerificationResult } from "../result.js";
import { SYNTHETIC_PROVIDER_NAME } from "../../synthetic/payload.js";
import { SYNTHETIC_SIGNATURE_HEADER } from "./constants.js";
import {
  computeSyntheticSignatureDigest,
  parseSyntheticSignatureHeader,
} from "./scheme.js";

export type SyntheticSignatureVerifierOptions = {
  readonly secret: string;
  readonly toleranceSeconds: number;
};

/**
 * HMAC-SHA256 over `timestampSeconds + "." + rawBody` for the SYNTHETIC provider.
 *
 * Local development and tests only. Not Razorpay, Stripe, or any live PSP.
 */
export class SyntheticSignatureVerifier implements SignatureVerifier {
  public readonly provider: ProviderId = providerId(SYNTHETIC_PROVIDER_NAME);
  private readonly secret: string;
  private readonly toleranceSeconds: number;

  public constructor(options: SyntheticSignatureVerifierOptions) {
    if (typeof options.secret !== "string" || options.secret.length === 0) {
      throw new Error("Synthetic webhook secret is not configured");
    }
    if (
      !Number.isInteger(options.toleranceSeconds) ||
      options.toleranceSeconds < 0
    ) {
      throw new Error("Synthetic webhook signature tolerance is invalid");
    }
    this.secret = options.secret;
    this.toleranceSeconds = options.toleranceSeconds;
  }

  public verify(input: SignatureVerificationInput): SignatureVerificationResult {
    const parsed = parseSyntheticSignatureHeader(
      headerValue(input.headers, SYNTHETIC_SIGNATURE_HEADER),
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

    const rawBody = toRawBodyBytes(input.rawBody);
    const expected = computeSyntheticSignatureDigest(
      this.secret,
      parsed.timestampSeconds,
      rawBody,
    );

    if (!signaturesEqual(expected, parsed.digest)) {
      return {
        status: "INVALID_SIGNATURE",
        reason: "Webhook signature is invalid",
      };
    }

    const nowSeconds = unixSecondsFromInstant(input.now);
    const delta = Math.abs(nowSeconds - parsed.timestampSeconds);
    if (delta > this.toleranceSeconds) {
      return {
        status: "EXPIRED_SIGNATURE",
        reason: "Webhook signature has expired",
      };
    }

    return {
      status: "VERIFIED",
      reason: "Webhook signature is valid",
    };
  }
}
