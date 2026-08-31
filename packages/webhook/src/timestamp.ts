import { instant, type Instant } from "@hookx/domain";
import { WebhookError } from "./errors.js";

const UTC_Z =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]{1,9})?Z$/;
const UTC_OFFSET_ZERO =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]{1,9})?(?:\+00:00|-00:00)$/;

export function normalizeOccurredAt(value: unknown): Instant {
  if (typeof value !== "string") {
    throw new WebhookError(
      "INVALID_TIMESTAMP",
      "Event occurrence timestamp must be a UTC string",
    );
  }

  const zulu = UTC_Z.exec(value);
  if (zulu !== null) {
    const fraction = zulu[2] ?? ".000";
    return instant(`${zulu[1]}${fraction}Z`);
  }

  const offsetZero = UTC_OFFSET_ZERO.exec(value);
  if (offsetZero !== null) {
    const fraction = offsetZero[2] ?? ".000";
    return instant(`${offsetZero[1]}${fraction}Z`);
  }

  throw new WebhookError(
    "INVALID_TIMESTAMP",
    "Event occurrence timestamp must be a UTC instant",
  );
}
