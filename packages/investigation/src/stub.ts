import type { InvestigationContext } from "./context.js";
import type { Investigator } from "./investigator.js";
import { INVESTIGATION_PROMPT_VERSION } from "./prompt.js";
import type { InvestigationResult } from "./result.js";
import { validateInvestigationResult } from "./validate.js";
import type { InvestigationEvidence } from "./evidence.js";
import type { RecommendedActionCode } from "./recommendations.js";

function actionFor(context: InvestigationContext): RecommendedActionCode {
  switch (context.exception.exceptionCode) {
    case "CONFLICTING_EVENT":
      return "INVESTIGATE_CONFLICTING_PAYLOAD";
    case "OUT_OF_ORDER_EVENT":
    case "MISSING_EVENT":
      return "WAIT_FOR_EXPECTED_EVENT";
    case "PROCESSING_FAILURE":
    case "RETRY_EXHAUSTED":
      return "RETRY_PROCESSING";
    case "DUPLICATE_EVENT":
      return "NO_ACTION";
    default:
      return "REQUEST_OPERATOR_REVIEW";
  }
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
      return "The provider likely retried an identical webhook delivery.";
    case "RETRY_EXHAUSTED":
      return "Temporary processing failures may have continued until the retry budget was consumed.";
    case "INVALID_SIGNATURE":
      return "The delivery may have used an incorrect or stale signature.";
    default:
      return "A deterministic rule classified this exception; the underlying provider or operator condition is not confirmed.";
  }
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
    context: InvestigationContext,
  ): Promise<InvestigationResult> {
    const exception = context.exception;
    const webhook =
      context.webhooks.find(
        (row) => row.webhookEventId === exception.webhookEventId,
      ) ?? context.webhooks[0];
    const evidence: InvestigationEvidence[] = [
      {
        sourceType: "EXCEPTION",
        sourceId: exception.exceptionId,
        fact: `Deterministic engine classified ${exception.exceptionCode} with status ${exception.status} and severity ${exception.severity}.`,
      },
    ];
    if (webhook !== undefined) {
      evidence.push({
        sourceType: "WEBHOOK_EVENT",
        sourceId: webhook.webhookEventId,
        fact: `Stored webhook ${webhook.eventType} has processing status ${webhook.processingStatus}.`,
      });
    }
    const transition = context.audit.find(
      (row) => row.eventType === "PAYMENT_STATE_CHANGED",
    );
    if (transition !== undefined) {
      evidence.push({
        sourceType: "STATE_TRANSITION",
        sourceId: transition.auditEventId,
        fact: `Recorded transition ${transition.previousState ?? "NONE"} to ${transition.resultingState ?? "NONE"}.`,
      });
    }
    const retry = context.retries[0];
    if (retry !== undefined) {
      evidence.push({
        sourceType: "RETRY_ATTEMPT",
        sourceId: retry.retryId,
        fact: `Retry status ${retry.status} after ${String(retry.attemptCount)} attempt(s).`,
      });
    }
    const rule = context.applicableRules[0];
    const facts = [
      `Exception code ${exception.exceptionCode} was assigned by deterministic detection, not by this investigator.`,
      webhook === undefined
        ? "No stored webhook was supplied for this exception."
        : `Relevant webhook event type is ${webhook.eventType}.`,
    ];
    if (rule !== undefined) {
      facts.push(rule.statement);
    }
    return validateInvestigationResult(
      {
        summary: `Read-only investigation of ${exception.exceptionCode}. Financial state was not modified.`,
        facts,
        evidence,
        likelyCause: causeFor(context),
        recommendedAction: {
          code: actionFor(context),
          detail: "Advisory only. Deterministic policy or an operator must approve any follow-up.",
        },
        confidence: "MEDIUM",
        limitations: [
          "This stub does not call an LLM.",
          "Classification remains the deterministic exception engine.",
          "Confidence describes the explanation, not that money is safe.",
        ],
      },
      context,
    );
  }
}
