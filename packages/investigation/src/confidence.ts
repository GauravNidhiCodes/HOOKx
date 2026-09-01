export const INVESTIGATION_CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;

export type InvestigationConfidence =
  (typeof INVESTIGATION_CONFIDENCE)[number];

export function isInvestigationConfidence(
  value: string,
): value is InvestigationConfidence {
  return (INVESTIGATION_CONFIDENCE as readonly string[]).includes(value);
}
