export const EVIDENCE_SOURCE_TYPES = [
  "WEBHOOK_EVENT",
  "EXCEPTION",
  "INCIDENT",
  "AUDIT_EVENT",
  "STATE_TRANSITION",
  "RETRY_ATTEMPT",
] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export function isEvidenceSourceType(value: string): value is EvidenceSourceType {
  return (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

export type InvestigationEvidence = {
  readonly sourceType: EvidenceSourceType;
  readonly sourceId: string;
  readonly fact: string;
};
