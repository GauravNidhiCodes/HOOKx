export const SIGNATURE_VERIFICATION_STATUS = {
  VERIFIED: "VERIFIED",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  MISSING_SIGNATURE: "MISSING_SIGNATURE",
  MALFORMED_SIGNATURE: "MALFORMED_SIGNATURE",
  EXPIRED_SIGNATURE: "EXPIRED_SIGNATURE",
} as const;

export type SignatureVerificationStatus =
  (typeof SIGNATURE_VERIFICATION_STATUS)[keyof typeof SIGNATURE_VERIFICATION_STATUS];

export type SignatureVerificationResult = {
  readonly status: SignatureVerificationStatus;
  readonly reason: string;
};
