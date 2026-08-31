import { timingSafeEqual } from "node:crypto";

/**
 * Compare HMAC digests without using JavaScript `===` / `!==` on the secret
 * material. Length mismatches cannot use `timingSafeEqual` (it throws); a
 * dummy same-buffer compare still runs so the function does not take an
 * obviously cheaper path with no crypto work.
 */
export function signaturesEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
