import { DomainError, type Instant } from "@hookx/domain";

const INSTANT_UTC =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z$/;

function instantSortKey(value: Instant): string {
  const match = INSTANT_UTC.exec(value);
  if (match === null) {
    throw new DomainError(
      "INVALID_INSTANT",
      "instant must be an ISO-8601 UTC timestamp ending in Z",
    );
  }

  const fraction = (match[7] ?? "").padEnd(9, "0");
  return `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${match[6]}${fraction}`;
}

export function compareInstant(left: Instant, right: Instant): -1 | 0 | 1 {
  const a = instantSortKey(left);
  const b = instantSortKey(right);
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
