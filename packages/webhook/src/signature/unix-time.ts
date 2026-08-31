import type { Instant } from "@hookx/domain";
import { DomainError } from "@hookx/domain";

const INSTANT_PARTS =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/;

/**
 * Convert an injected UTC instant to unix seconds.
 * Uses calendar components from the string, not `Date.now()`.
 */
export function unixSecondsFromInstant(value: Instant): number {
  const match = INSTANT_PARTS.exec(value);
  if (match === null) {
    throw new DomainError(
      "INVALID_INSTANT",
      "instant must be an ISO-8601 UTC timestamp ending in Z",
    );
  }
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Math.floor(ms / 1000);
}
