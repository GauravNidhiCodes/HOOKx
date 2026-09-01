import type { InvestigationContext } from "./context.js";

/**
 * Evidence is insufficient to establish a cause when the package has no
 * webhook rows, no payment projection, no retry rows, and no audit rows.
 * The exception record alone is not enough to invent a root cause.
 */
export function isInsufficientEvidence(context: InvestigationContext): boolean {
  return (
    context.webhooks.length === 0 &&
    context.payment === null &&
    context.retries.length === 0 &&
    context.audit.length === 0
  );
}

export function evidenceConflictNote(
  context: InvestigationContext,
): string | null {
  const statuses = new Set(context.retries.map((row) => row.status));
  if (statuses.has("SUCCEEDED") && statuses.has("DEAD_LETTERED")) {
    return "Retry history contains both SUCCEEDED and DEAD_LETTERED.";
  }
  const duplicate = context.audit.some(
    (row) => row.eventType === "WEBHOOK_DUPLICATE",
  );
  const conflict = context.audit.some(
    (row) =>
      row.eventType === "WEBHOOK_CONFLICT" ||
      row.eventType === "WEBHOOK_CONFLICT_DETECTED",
  );
  if (duplicate && conflict) {
    return "Audit history records both duplicate delivery and a conflicting payload.";
  }
  return null;
}
