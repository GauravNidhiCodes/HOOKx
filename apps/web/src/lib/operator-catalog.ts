export const OPERATOR_EVENT_TYPES = [
  "payment.created",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "refund.created",
] as const;

export const OPERATOR_PROCESSING_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "REJECTED",
  "CONFLICT",
] as const;

export const ADVISORY_AUTHORITATIVE =
  "ADVISORY — DETERMINISTIC SYSTEM REMAINS AUTHORITATIVE";
