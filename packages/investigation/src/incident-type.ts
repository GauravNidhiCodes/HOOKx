import type { ExceptionCode } from "@hookx/exceptions";

/**
 * Explanatory incident classification. This is not the source of truth.
 * The deterministic exception code remains authoritative.
 */
export const INVESTIGATION_INCIDENT_TYPES = [
  "DUPLICATE_DELIVERY",
  "CONFLICTING_EVENT",
  "OUT_OF_ORDER_EVENT",
  "TRANSIENT_FAILURE",
  "PERMANENT_FAILURE",
  "RETRY_EXHAUSTION",
  "INVALID_SIGNATURE",
  "UNSUPPORTED_EVENT",
  "INSUFFICIENT_EVIDENCE",
  "UNKNOWN",
] as const;

export type InvestigationIncidentType =
  (typeof INVESTIGATION_INCIDENT_TYPES)[number];

export function isInvestigationIncidentType(
  value: string,
): value is InvestigationIncidentType {
  return (INVESTIGATION_INCIDENT_TYPES as readonly string[]).includes(value);
}

export const INSUFFICIENT_EVIDENCE_ROOT_CAUSE = "INSUFFICIENT EVIDENCE";

const BY_EXCEPTION: Readonly<Record<ExceptionCode, InvestigationIncidentType>> =
  Object.freeze({
    DUPLICATE_EVENT: "DUPLICATE_DELIVERY",
    CONFLICTING_EVENT: "CONFLICTING_EVENT",
    OUT_OF_ORDER_EVENT: "OUT_OF_ORDER_EVENT",
    MISSING_EVENT: "OUT_OF_ORDER_EVENT",
    PROCESSING_FAILURE: "TRANSIENT_FAILURE",
    RETRY_EXHAUSTED: "RETRY_EXHAUSTION",
    INVALID_SIGNATURE: "INVALID_SIGNATURE",
    UNSUPPORTED_EVENT: "UNSUPPORTED_EVENT",
    MALFORMED_WEBHOOK: "UNKNOWN",
    INVALID_STATE_TRANSITION: "PERMANENT_FAILURE",
  });

export function explanatoryIncidentTypeFor(
  code: ExceptionCode,
): InvestigationIncidentType {
  return BY_EXCEPTION[code];
}
