import { toRawBodyBytes } from "../headers.js";
import {
  computeSyntheticSignatureDigest,
  formatSyntheticSignatureHeader,
} from "./scheme.js";

/**
 * Build a synthetic `X-Hookx-Signature` header for tests and local development.
 * Not a live payment-provider scheme.
 */
export function signSyntheticWebhook(input: {
  readonly secret: string;
  readonly rawBody: string | Uint8Array;
  readonly timestampSeconds: number;
}): string {
  const digest = computeSyntheticSignatureDigest(
    input.secret,
    input.timestampSeconds,
    toRawBodyBytes(input.rawBody),
  );
  return formatSyntheticSignatureHeader(input.timestampSeconds, digest);
}
