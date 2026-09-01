import type { InvestigationContext } from "./context.js";
import type { Investigator } from "./investigator.js";
import { INVESTIGATION_PROMPT_VERSION } from "./prompt.js";
import type { InvestigationResult } from "./result.js";
import { validateInvestigationResult } from "./validate.js";
import type { InvestigationEvidence } from "./evidence.js";
import type { RecommendedActionCode } from "./recommendations.js";
import type { InvestigationConfidence } from "./confidence.js";
import {
  explanatoryIncidentTypeFor,
  INSUFFICIENT_EVIDENCE_ROOT_CAUSE,
} from "./incident-type.js";
import {
  evidenceConflictNote,
  isInsufficientEvidence,
} from "./insufficient.js";

function actionFor(context: InvestigationContext): RecommendedActionCode {
  switch (context.exception.exceptionCode) {
    case "CONFLICTING_EVENT":
      return "INVESTIGATE_CONFLICTING_PAYLOAD";
    case "OUT_OF_ORDER_EVENT":
    case "MISSING_EVENT":
      return "WAIT_FOR_EXPECTED_EVENT";
    case "PROCESSING_FAILURE":
      return "RETRY_PROCESSING";
    case "RETRY_EXHAUSTED":
      return "REQUEST_OPERATOR_REVIEW";
    case "DUPLICATE_EVENT":
      return "INSPECT_PROVIDER_EVENT_HISTORY";
    default:
      return "REQUEST_OPERATOR_REVIEW";
  }
}

function duplicateAction(context: InvestigationContext): RecommendedActionCode {
  const repeats = context.audit.filter(
    (row) => row.eventType === "WEBHOOK_DUPLICATE",
  ).length;
  return repeats > 1 ? "INSPECT_PROVIDER_EVENT_HISTORY" : "NO_ACTION";
}

function causeFor(context: InvestigationContext): string {
  switch (context.exception.exceptionCode) {
    case "CONFLICTING_EVENT":
      return "The provider may have retried the same event identity with a different payload.";
    case "OUT_OF_ORDER_EVENT":
      return "The provider may have delivered events out of chronological order.";
    case "MISSING_EVENT":
      return "A required predecessor event may not have been delivered yet.";
    case "DUPLICATE_EVENT":
      return "Duplicate delivery of the same provider event identity.";
    case "RETRY_EXHAUSTED":
      return "Temporary processing failures continued until the retry budget was consumed.";
    case "INVALID_SIGNATURE":
      return "The delivery may have used an incorrect or stale signature.";
    case "PROCESSING_FAILURE":
      return "Processing failed once and was classified as a transient failure.";
    default:
      return "A deterministic rule classified this exception; the underlying provider or operator condition is not confirmed.";
  }
}

function impactFor(context: InvestigationContext): string {
  const transitions = context.audit.filter(
    (row) => row.eventType === "PAYMENT_STATE_CHANGED",
  );
  const dead = context.retries.some((row) => row.deadLettered);
  const delayed = context.replay.delayed || context.replay.orderingMismatch;
  switch (context.exception.exceptionCode) {
    case "DUPLICATE_EVENT":
      return transitions.length <= 1
        ? "No additional economic state transition occurred for the duplicate delivery."
        : `Audit records ${String(transitions.length)} payment state transition(s). Duplicate classification did not authorize a second financial mutation.`;
    case "CONFLICTING_EVENT":
      return `Original stored event remains authoritative. Payment projection is ${context.payment?.state ?? "unchanged / not projected"}.`;
    case "OUT_OF_ORDER_EVENT":
    case "MISSING_EVENT":
      return delayed
        ? "Processing was delayed until event time order could be applied. No financial correction is implied."
        : "The event was retained without forcing an invalid transition.";
    case "RETRY_EXHAUSTED":
      return dead
        ? "The event reached dead-letter state after the configured retry budget. Payment state was not invented by this investigator."
        : "Retry budget was exhausted. Inspect the retry row in the supplied evidence.";
    case "PROCESSING_FAILURE": {
      const succeeded = context.retries.some((row) => row.status === "SUCCEEDED");
      return succeeded
        ? "Retry eventually succeeded. The supplied evidence does not show a second independent financial capture."
        : "Processing failed; a retry was scheduled. No customer-loss claim is supported.";
    }
    default:
      return "Operational impact is limited to the supplied webhook, retry, and audit evidence. Financial loss is not inferred.";
  }
}

function confidenceFor(
  context: InvestigationContext,
): { readonly confidence: InvestigationConfidence; readonly reason: string } {
  const conflict = evidenceConflictNote(context);
  if (conflict !== null) {
    return { confidence: "LOW", reason: conflict };
  }
  const code = context.exception.exceptionCode;
  const hasDuplicateAudit = context.audit.some(
    (row) => row.eventType === "WEBHOOK_DUPLICATE",
  );
  const hasConflictAudit = context.audit.some(
    (row) =>
      row.eventType === "WEBHOOK_CONFLICT" ||
      row.eventType === "WEBHOOK_CONFLICT_DETECTED",
  );
  const hasRetryExhausted = context.audit.some(
    (row) =>
      row.eventType === "RETRY_EXHAUSTED" ||
      row.eventType === "RETRY_DEAD_LETTERED",
  );
  if (code === "DUPLICATE_EVENT" && hasDuplicateAudit && context.webhooks.length > 0) {
    return {
      confidence: "HIGH",
      reason: "Duplicate classification is corroborated by WEBHOOK_DUPLICATE audit and a stored webhook identity.",
    };
  }
  if (code === "CONFLICTING_EVENT" && hasConflictAudit && context.webhooks.length > 0) {
    return {
      confidence: "HIGH",
      reason: "Conflict classification is corroborated by conflict audit and the stored webhook identity.",
    };
  }
  if (code === "RETRY_EXHAUSTED" && hasRetryExhausted) {
    return {
      confidence: "HIGH",
      reason: "Retry exhaustion is corroborated by dead-letter or RETRY_EXHAUSTED audit.",
    };
  }
  if (code === "OUT_OF_ORDER_EVENT" && context.replay.orderingMismatch) {
    return {
      confidence: "HIGH",
      reason: "Delivery order and event-time order in the supplied webhooks do not match.",
    };
  }
  return {
    confidence: "MEDIUM",
    reason: "The deterministic exception is present; some supporting audit or webhook rows may be incomplete.",
  };
}

function gatherEvidence(context: InvestigationContext): InvestigationEvidence[] {
  const exception = context.exception;
  const evidence: InvestigationEvidence[] = [
    {
      sourceType: "INCIDENT",
      sourceId: context.incident.incidentId,
      fact: `Incident ${context.incident.incidentId} is the persisted exception ${exception.exceptionCode} at status ${exception.status}.`,
    },
    {
      sourceType: "EXCEPTION",
      sourceId: exception.exceptionId,
      fact: `Deterministic engine classified ${exception.exceptionCode} with status ${exception.status} and severity ${exception.severity}.`,
    },
  ];
  const webhook =
    context.webhooks.find(
      (row) => row.webhookEventId === exception.webhookEventId,
    ) ?? context.webhooks[0];
  if (webhook !== undefined) {
    evidence.push({
      sourceType: "WEBHOOK_EVENT",
      sourceId: webhook.webhookEventId,
      fact: `Webhook ${webhook.externalEventId} type ${webhook.eventType} received ${webhook.receivedAt} occurred ${webhook.occurredAt} status ${webhook.processingStatus}.`,
    });
  }
  const transition = context.audit.find(
    (row) => row.eventType === "PAYMENT_STATE_CHANGED",
  );
  if (transition !== undefined) {
    evidence.push({
      sourceType: "STATE_TRANSITION",
      sourceId: transition.auditEventId,
      fact: `Recorded transition ${transition.previousState ?? "NONE"} to ${transition.resultingState ?? "NONE"} at ${transition.recordedAt}.`,
    });
  }
  const duplicate = context.audit.find(
    (row) => row.eventType === "WEBHOOK_DUPLICATE",
  );
  if (duplicate !== undefined) {
    evidence.push({
      sourceType: "AUDIT_EVENT",
      sourceId: duplicate.auditEventId,
      fact: `Duplicate delivery recorded at ${duplicate.recordedAt} with reason ${duplicate.reason}.`,
    });
  }
  const conflict = context.audit.find(
    (row) =>
      row.eventType === "WEBHOOK_CONFLICT" ||
      row.eventType === "WEBHOOK_CONFLICT_DETECTED",
  );
  if (conflict !== undefined) {
    evidence.push({
      sourceType: "AUDIT_EVENT",
      sourceId: conflict.auditEventId,
      fact: `Conflicting delivery recorded at ${conflict.recordedAt} with reason ${conflict.reason}.`,
    });
  }
  const delayed = context.audit.find((row) => row.eventType === "WEBHOOK_DELAYED");
  if (delayed !== undefined) {
    evidence.push({
      sourceType: "AUDIT_EVENT",
      sourceId: delayed.auditEventId,
      fact: `WEBHOOK_DELAYED recorded at ${delayed.recordedAt}.`,
    });
  }
  const retry = context.retries[0];
  if (retry !== undefined) {
    evidence.push({
      sourceType: "RETRY_ATTEMPT",
      sourceId: retry.retryId,
      fact: `Retry status ${retry.status} after ${String(retry.attemptCount)} attempt(s)${retry.deadLettered ? "; dead-lettered" : ""}.`,
    });
  }
  return evidence.slice(0, 16);
}

function summaryFor(context: InvestigationContext): string {
  const webhook =
    context.webhooks.find(
      (row) => row.webhookEventId === context.exception.webhookEventId,
    ) ?? context.webhooks[0];
  const identity =
    webhook === undefined
      ? "no stored webhook identity"
      : `provider event identity ${webhook.externalEventId}`;
  return [
    `Read-only investigation of incident ${context.incident.incidentId}.`,
    `Deterministic code ${context.exception.exceptionCode} with ${identity}.`,
    `Payment projection is ${context.payment?.state ?? "not present"}.`,
    "Financial state was not modified by this investigator.",
  ].join(" ");
}

/**
 * Deterministic investigator used when no LLM credentials are configured.
 * Output is bound to the supplied context and contains no invented identifiers.
 */
export class StubInvestigator implements Investigator {
  public readonly implementation = "stub";
  public readonly modelId = null;
  public readonly promptVersion = INVESTIGATION_PROMPT_VERSION;

  public async investigate(
    input: InvestigationContext,
  ): Promise<InvestigationResult> {
    if (isInsufficientEvidence(input)) {
      return validateInvestigationResult(
        {
          summary:
            "The supplied evidence package does not contain webhook, payment, retry, or audit history.",
          facts: [
            `Exception ${input.exception.exceptionId} is present with code ${input.exception.exceptionCode}.`,
            "No webhook, payment, retry, or audit rows were supplied.",
          ],
          evidence: [
            {
              sourceType: "EXCEPTION",
              sourceId: input.exception.exceptionId,
              fact: `Stored exception ${input.exception.exceptionCode} exists; event history was not supplied.`,
            },
          ],
          incidentType: "INSUFFICIENT_EVIDENCE",
          severity: input.exception.severity,
          rootCause: INSUFFICIENT_EVIDENCE_ROOT_CAUSE,
          likelyCause: INSUFFICIENT_EVIDENCE_ROOT_CAUSE,
          impact: "Impact cannot be determined from the supplied evidence.",
          recommendedAction: {
            code: "REQUEST_OPERATOR_REVIEW",
            detail: "Gather webhook and audit history before drawing a cause. Advisory only.",
          },
          confidence: "LOW",
          confidenceReason: "Event history is missing, so a cause cannot be established.",
          limitations: [
            "The available event history does not establish the cause.",
            "This stub does not call an LLM.",
            "Classification remains the deterministic exception engine.",
          ],
        },
        input,
      );
    }
    const exception = input.exception;
    const webhook =
      input.webhooks.find(
        (row) => row.webhookEventId === exception.webhookEventId,
      ) ?? input.webhooks[0];
    const rule = input.applicableRules[0];
    const facts = [
      `Exception code ${exception.exceptionCode} was assigned by deterministic detection, not by this investigator.`,
      webhook === undefined
        ? "No stored webhook was supplied for this exception."
        : `Relevant webhook event type is ${webhook.eventType} with processing status ${webhook.processingStatus}.`,
    ];
    if (rule !== undefined) {
      facts.push(rule.statement);
    }
    const rated = confidenceFor(input);
    const code =
      exception.exceptionCode === "DUPLICATE_EVENT"
        ? duplicateAction(input)
        : actionFor(input);
    return validateInvestigationResult(
      {
        summary: summaryFor(input),
        facts,
        evidence: gatherEvidence(input),
        incidentType: explanatoryIncidentTypeFor(exception.exceptionCode),
        severity: exception.severity,
        rootCause: causeFor(input),
        likelyCause: causeFor(input),
        impact: impactFor(input),
        recommendedAction: {
          code,
          detail: "Advisory only. Deterministic policy or an operator must approve any follow-up. This is not an executable financial action.",
        },
        confidence: rated.confidence,
        confidenceReason: rated.reason,
        limitations: [
          "This stub does not call an LLM.",
          "Classification remains the deterministic exception engine.",
          "Confidence describes the explanation, not financial certainty.",
        ],
      },
      input,
    );
  }
}
