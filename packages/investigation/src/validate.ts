import type { InvestigationContext } from "./context.js";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";
import type { InvestigationResult } from "./result.js";
import { createInvestigationResult } from "./result.js";

const IDENTIFIER =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|SYNTHETIC:[A-Za-z0-9._:~-]+|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/gi;

export function contextIdentifierCatalog(
  context: InvestigationContext,
): ReadonlySet<string> {
  const ids = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value !== null && value !== undefined && value.length > 0) {
      ids.add(value);
    }
  };
  add(context.correlationId);
  add(context.exception.exceptionId);
  add(context.exception.webhookEventId);
  add(context.exception.paymentId);
  add(context.exception.correlationId);
  add(context.exception.detectedAt);
  add(context.investigatedAt);
  if (context.payment !== null) {
    add(context.payment.paymentId);
    add(context.payment.amountMinor);
    add(context.payment.lastOccurredAt);
  }
  for (const webhook of context.webhooks) {
    add(webhook.webhookEventId);
    add(webhook.externalEventId);
    add(webhook.occurredAt);
    add(webhook.receivedAt);
    add(webhook.amountMinor);
  }
  for (const retry of context.retries) {
    add(retry.retryId);
    add(retry.webhookEventId);
    if (retry.lastErrorCode !== null) {
      add(retry.lastErrorCode);
    }
    add(retry.lastFailedAt ?? undefined);
  }
  for (const audit of context.audit) {
    add(audit.auditEventId);
    add(audit.occurredAt);
    add(audit.recordedAt);
  }
  for (const rule of context.applicableRules) {
    add(rule.id);
  }
  return ids;
}

function evidenceAllowed(
  context: InvestigationContext,
  sourceType: string,
  sourceId: string,
): boolean {
  if (sourceType === "EXCEPTION") {
    return sourceId === context.exception.exceptionId;
  }
  if (sourceType === "WEBHOOK_EVENT") {
    return context.webhooks.some((row) => row.webhookEventId === sourceId);
  }
  if (sourceType === "AUDIT_EVENT" || sourceType === "STATE_TRANSITION") {
    return context.audit.some((row) => row.auditEventId === sourceId);
  }
  if (sourceType === "RETRY_ATTEMPT") {
    return context.retries.some((row) => row.retryId === sourceId);
  }
  return false;
}

function scanInventedIdentifiers(
  text: string,
  catalog: ReadonlySet<string>,
): void {
  const matches = text.match(IDENTIFIER) ?? [];
  for (const match of matches) {
    if (!catalog.has(match)) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE,
        "Output referenced an identifier that is not in the supplied context",
      );
    }
  }
}

/**
 * Schema-validate then bind every evidence item to the supplied context.
 * Parsing JSON is not sufficient.
 */
export function validateInvestigationResult(
  input: unknown,
  context: InvestigationContext,
): InvestigationResult {
  const result = createInvestigationResult(input);
  const catalog = contextIdentifierCatalog(context);
  for (const item of result.evidence) {
    if (!evidenceAllowed(context, item.sourceType, item.sourceId)) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.INVALID_EVIDENCE,
        "Evidence sourceId is not present in the investigation context",
      );
    }
    scanInventedIdentifiers(item.fact, catalog);
  }
  scanInventedIdentifiers(result.summary, catalog);
  scanInventedIdentifiers(result.likelyCause, catalog);
  for (const fact of result.facts) {
    scanInventedIdentifiers(fact, catalog);
  }
  scanInventedIdentifiers(result.recommendedAction.detail, catalog);
  return result;
}

export function parseModelJson(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "Model output is not JSON",
    );
  }
  return parsed;
}
