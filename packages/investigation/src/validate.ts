import type { InvestigationContext } from "./context.js";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";
import type { InvestigationResult } from "./result.js";
import { createInvestigationResult } from "./result.js";
import {
  INSUFFICIENT_EVIDENCE_ROOT_CAUSE,
} from "./incident-type.js";
import {
  evidenceConflictNote,
  isInsufficientEvidence,
} from "./insufficient.js";

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
  add(context.evidenceHash);
  add(context.incident.incidentId);
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
  for (const id of context.replay.deliveryOrder) {
    add(id);
  }
  for (const id of context.replay.eventTimeOrder) {
    add(id);
  }
  return ids;
}

function evidenceAllowed(
  context: InvestigationContext,
  sourceType: string,
  sourceId: string,
): boolean {
  if (sourceType === "EXCEPTION" || sourceType === "INCIDENT") {
    return (
      sourceId === context.exception.exceptionId ||
      sourceId === context.incident.incidentId
    );
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
  for (const raw of matches) {
    const match = raw.replace(/[.,;:]+$/u, "");
    if (match.length === 0) {
      continue;
    }
    if (!catalog.has(match) && !catalog.has(raw)) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE,
        "Output referenced an identifier that is not in the supplied context: " +
          match,
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
  const parsed = createInvestigationResult(input);
  const catalog = contextIdentifierCatalog(context);
  for (const item of parsed.evidence) {
    if (!evidenceAllowed(context, item.sourceType, item.sourceId)) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.INVALID_EVIDENCE,
        "Evidence sourceId is not present in the investigation context",
      );
    }
    scanInventedIdentifiers(item.fact, catalog);
  }
  scanInventedIdentifiers(parsed.summary, catalog);
  scanInventedIdentifiers(parsed.rootCause, catalog);
  scanInventedIdentifiers(parsed.likelyCause, catalog);
  scanInventedIdentifiers(parsed.impact, catalog);
  scanInventedIdentifiers(parsed.confidenceReason, catalog);
  for (const fact of parsed.facts) {
    scanInventedIdentifiers(fact, catalog);
  }
  for (const action of parsed.recommendedActions) {
    scanInventedIdentifiers(action.detail, catalog);
  }
  if (isInsufficientEvidence(context)) {
    if (parsed.incidentType !== "INSUFFICIENT_EVIDENCE") {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE,
        "Insufficient evidence must not invent a root-cause classification",
      );
    }
    if (parsed.rootCause !== INSUFFICIENT_EVIDENCE_ROOT_CAUSE) {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE,
        "Insufficient evidence must not invent a root cause",
      );
    }
    if (parsed.confidence !== "LOW") {
      throw new InvestigationError(
        INVESTIGATION_ERROR_CODE.INVALID_CONFIDENCE,
        "Insufficient evidence requires LOW confidence",
      );
    }
  }
  const conflict = evidenceConflictNote(context);
  if (conflict !== null && parsed.confidence === "HIGH") {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_CONFIDENCE,
      "Conflicting evidence cannot be HIGH confidence",
    );
  }
  return Object.freeze({
    ...parsed,
    severity: context.exception.severity,
  });
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
