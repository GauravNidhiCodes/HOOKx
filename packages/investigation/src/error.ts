export class InvestigationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "InvestigationError";
    this.code = code;
  }
}

export const INVESTIGATION_ERROR_CODE = {
  MALFORMED_MODEL_OUTPUT: "MALFORMED_MODEL_OUTPUT",
  INVALID_EVIDENCE: "INVALID_EVIDENCE",
  HALLUCINATED_EVIDENCE: "HALLUCINATED_EVIDENCE",
  INVALID_RECOMMENDATION: "INVALID_RECOMMENDATION",
  INVALID_CONFIDENCE: "INVALID_CONFIDENCE",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_INVESTIGATION: "INVALID_INVESTIGATION",
} as const;

export type InvestigationErrorCode =
  (typeof INVESTIGATION_ERROR_CODE)[keyof typeof INVESTIGATION_ERROR_CODE];
