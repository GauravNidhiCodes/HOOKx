import { createHmac } from "node:crypto";
import { toRawBodyBytes } from "../signature/headers.js";

/**
 * Official Razorpay webhook MAC:
 * HMAC-SHA256(key = webhook secret, message = raw request body) as hex.
 *
 * Source: https://razorpay.com/docs/webhooks/validate-test/
 * Confirmed by razorpay-node `validateWebhookSignature`
 * (`createHmac('sha256', secret).update(body).digest('hex')`).
 *
 * Do not parse or re-stringify JSON before this HMAC.
 */
export function computeRazorpaySignatureDigest(
  secret: string,
  rawBody: string | Uint8Array,
): Uint8Array {
  const hmac = createHmac("sha256", secret);
  hmac.update(toRawBodyBytes(rawBody));
  return hmac.digest();
}

const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;

export function parseRazorpaySignatureHeader(
  value: string | undefined,
):
  | { readonly ok: true; readonly digest: Uint8Array }
  | { readonly ok: false; readonly status: "MISSING_SIGNATURE" | "MALFORMED_SIGNATURE" } {
  if (value === undefined) {
    return { ok: false, status: "MISSING_SIGNATURE" };
  }
  if (!HEX_DIGEST.test(value)) {
    return { ok: false, status: "MALFORMED_SIGNATURE" };
  }
  return { ok: true, digest: Buffer.from(value, "hex") };
}
