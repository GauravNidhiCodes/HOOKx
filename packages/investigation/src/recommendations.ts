/**
 * Advisory-only actions. None of these may capture, refund, settle, or
 * otherwise mutate financial state. Callers must not treat them as executable
 * commands.
 */
export const RECOMMENDED_ACTION_CODES = [
  "RETRY_PROCESSING",
  "INSPECT_PROVIDER_EVENT_HISTORY",
  "REQUEST_OPERATOR_REVIEW",
  "WAIT_FOR_EXPECTED_EVENT",
  "INVESTIGATE_CONFLICTING_PAYLOAD",
  "NO_ACTION",
] as const;

export type RecommendedActionCode = (typeof RECOMMENDED_ACTION_CODES)[number];

export function isRecommendedActionCode(
  value: string,
): value is RecommendedActionCode {
  return (RECOMMENDED_ACTION_CODES as readonly string[]).includes(value);
}

const FORBIDDEN_ACTION =
  /\b(capture|refund|settle|payout|charge|debit|credit)\b.{0,24}\b(payment|money|funds|amount)\b/i;

export function isForbiddenFinancialAction(text: string): boolean {
  return FORBIDDEN_ACTION.test(text);
}

export type RecommendedAction = {
  readonly code: RecommendedActionCode;
  readonly detail: string;
  readonly executable: false;
};
