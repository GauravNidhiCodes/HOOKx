import type { ExceptionCode } from "./codes.js";

/**
 * Deterministic processing/display order when one detection context yields
 * several independent exceptions. Lower index is evaluated first.
 *
 * This list does not overwrite. Unrelated codes are all preserved.
 *
 * 1. Security (signature)
 * 2. Malformed / unsupported ingest
 * 3. Conflicting stored identity
 * 4. Invalid domain transition
 * 5. Processing failure
 * 6. Retry exhaustion
 * 7. Out-of-order
 * 8. Missing expected predecessor (only when the transition table is unique)
 * 9. Duplicate delivery
 */
export const EXCEPTION_PRECEDENCE: readonly ExceptionCode[] = Object.freeze([
  "INVALID_SIGNATURE",
  "MALFORMED_WEBHOOK",
  "UNSUPPORTED_EVENT",
  "CONFLICTING_EVENT",
  "INVALID_STATE_TRANSITION",
  "PROCESSING_FAILURE",
  "RETRY_EXHAUSTED",
  "OUT_OF_ORDER_EVENT",
  "MISSING_EVENT",
  "DUPLICATE_EVENT",
]);

const RANK: ReadonlyMap<ExceptionCode, number> = new Map(
  EXCEPTION_PRECEDENCE.map((code, index) => [code, index]),
);

export function exceptionPrecedenceRank(code: ExceptionCode): number {
  return RANK.get(code) ?? EXCEPTION_PRECEDENCE.length;
}

export function compareExceptionCode(
  left: ExceptionCode,
  right: ExceptionCode,
): number {
  return exceptionPrecedenceRank(left) - exceptionPrecedenceRank(right);
}
