import { computeRazorpaySignatureDigest } from "./scheme.js";

/**
 * Hex HMAC for tests and local synthetic Razorpay deliveries.
 * Same algorithm as official `validateWebhookSignature`. Not a live dashboard secret.
 */
export function signRazorpayWebhook(input: {
  readonly secret: string;
  readonly rawBody: string | Uint8Array;
}): string {
  return Buffer.from(
    computeRazorpaySignatureDigest(input.secret, input.rawBody),
  ).toString("hex");
}
