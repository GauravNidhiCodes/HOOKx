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

export const AI_GENERATED_ANALYSIS =
  "AI-GENERATED ANALYSIS — NOT AN AUTOMATED FINANCIAL DECISION";

export const INVESTIGATION_UNAVAILABLE =
  "INVESTIGATION UNAVAILABLE";
