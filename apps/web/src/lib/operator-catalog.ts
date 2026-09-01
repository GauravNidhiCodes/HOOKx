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

export const AI_GENERATED_INVESTIGATION = "AI-GENERATED INVESTIGATION";

export const AI_READONLY = "READ-ONLY";

export const AI_NO_FINANCIAL_STATE_CHANGES = "NO FINANCIAL STATE CHANGES";

export const INVESTIGATION_UNAVAILABLE =
  "INVESTIGATION UNAVAILABLE";
