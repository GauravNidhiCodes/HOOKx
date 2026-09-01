import { DomainError, instant, type Instant } from "@hookx/domain";
import { isExceptionSeverity, type ExceptionSeverity } from "@hookx/exceptions";
import {
  isInvestigationConfidence,
  type InvestigationConfidence,
} from "./confidence.js";
import type { InvestigationEvidence } from "./evidence.js";
import { isEvidenceSourceType } from "./evidence.js";
import {
  INSUFFICIENT_EVIDENCE_ROOT_CAUSE,
  isInvestigationIncidentType,
  type InvestigationIncidentType,
} from "./incident-type.js";
import {
  isForbiddenFinancialAction,
  isRecommendedActionCode,
  type RecommendedAction,
} from "./recommendations.js";
import { INVESTIGATION_ERROR_CODE, InvestigationError } from "./error.js";

export type InvestigationResult = {
  readonly summary: string;
  readonly facts: readonly string[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly incidentType: InvestigationIncidentType;
  readonly severity: ExceptionSeverity;
  readonly rootCause: string;
  readonly likelyCause: string;
  readonly impact: string;
  readonly recommendedActions: readonly RecommendedAction[];
  readonly recommendedAction: RecommendedAction;
  readonly confidence: InvestigationConfidence;
  readonly confidenceReason: string;
  readonly limitations: readonly string[];
};

const MAX_SUMMARY = 2_000;
const MAX_CAUSE = 2_000;
const MAX_FACT = 500;
const MAX_FACTS = 16;
const MAX_EVIDENCE = 16;
const MAX_LIMITATIONS = 12;
const MAX_ACTIONS = 8;
const PRINTABLE = /^[\u0020-\u007E\n]+$/;

const CLAIMED_CUSTOMER_LOSS =
  /\b(customer|user|payer)\b.{0,48}\b(lost|lose|losing)\b.{0,24}\b(money|funds|cash)\b/i;

export function claimsUnsupportedFinancialLoss(text: string): boolean {
  return CLAIMED_CUSTOMER_LOSS.test(text);
}

function assertText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      `${label} must be a string`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      `${label} length is invalid`,
    );
  }
  if (!PRINTABLE.test(trimmed)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      `${label} contains unsupported characters`,
    );
  }
  return trimmed;
}

function assertStringList(
  value: unknown,
  label: string,
  maxItems: number,
  maxItem: number,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      `${label} must be an array`,
    );
  }
  if (value.length === 0 || value.length > maxItems) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      `${label} count is invalid`,
    );
  }
  return Object.freeze(value.map((item, index) => assertText(item, `${label}[${index}]`, maxItem)));
}

function parseEvidence(value: unknown): readonly InvestigationEvidence[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "evidence must be a non-empty array within limits",
    );
  }
  return Object.freeze(
    value.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new InvestigationError(
          INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
          `evidence[${index}] must be an object`,
        );
      }
      const row = item as Record<string, unknown>;
      if (typeof row["sourceType"] !== "string" || !isEvidenceSourceType(row["sourceType"])) {
        throw new InvestigationError(
          INVESTIGATION_ERROR_CODE.INVALID_EVIDENCE,
          `evidence[${index}] sourceType is invalid`,
        );
      }
      const sourceId = assertText(row["sourceId"], `evidence[${index}].sourceId`, 128);
      const fact = assertText(row["fact"], `evidence[${index}].fact`, MAX_FACT);
      return Object.freeze({
        sourceType: row["sourceType"],
        sourceId,
        fact,
      });
    }),
  );
}

function parseAction(value: unknown, label: string): RecommendedAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      `${label} must be an object`,
    );
  }
  const row = value as Record<string, unknown>;
  if (typeof row["code"] !== "string" || !isRecommendedActionCode(row["code"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      `${label}.code is not an allowed advisory code`,
    );
  }
  const detail = assertText(row["detail"], `${label}.detail`, MAX_FACT);
  if (isForbiddenFinancialAction(detail) || isForbiddenFinancialAction(row["code"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      `${label} must not mutate financial state`,
    );
  }
  return Object.freeze({
    code: row["code"],
    detail,
    executable: false,
  });
}

function parseActions(row: Record<string, unknown>): {
  readonly recommendedAction: RecommendedAction;
  readonly recommendedActions: readonly RecommendedAction[];
} {
    if (row["recommendedAction"] !== undefined) {
      parseAction(row["recommendedAction"], "recommendedAction");
    }
    if (Array.isArray(row["recommendedActions"])) {
      if (
        row["recommendedActions"].length === 0 ||
        row["recommendedActions"].length > MAX_ACTIONS
      ) {
        throw new InvestigationError(
          INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
          "recommendedActions count is invalid",
        );
      }
      const recommendedActions = Object.freeze(
        row["recommendedActions"].map((item, index) =>
          parseAction(item, `recommendedActions[${String(index)}]`),
        ),
      );
      const first = recommendedActions[0];
      if (first === undefined) {
        throw new InvestigationError(
          INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
          "recommendedActions must not be empty",
        );
      }
      return { recommendedAction: first, recommendedActions };
    }
    const recommendedAction = parseAction(row["recommendedAction"], "recommendedAction");
    return {
      recommendedAction,
      recommendedActions: Object.freeze([recommendedAction]),
    };
}

function rejectLossAndMutation(text: string, label: string): void {
  if (isForbiddenFinancialAction(text) || claimsUnsupportedFinancialLoss(text)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      `${label} must not prescribe financial mutation or infer unproven customer loss`,
    );
  }
}

export function createInvestigationResult(
  input: unknown,
): InvestigationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "Investigation result must be an object",
    );
  }
  const row = input as Record<string, unknown>;
  const summary = assertText(row["summary"], "summary", MAX_SUMMARY);
  const rootCause = assertText(
    row["rootCause"] ?? row["likelyCause"],
    "rootCause",
    MAX_CAUSE,
  );
  const likelyCause = assertText(
    row["likelyCause"] ?? row["rootCause"],
    "likelyCause",
    MAX_CAUSE,
  );
  const impact = assertText(row["impact"], "impact", MAX_SUMMARY);
  const confidenceReason = assertText(
    row["confidenceReason"],
    "confidenceReason",
    MAX_CAUSE,
  );
  if (typeof row["confidence"] !== "string" || !isInvestigationConfidence(row["confidence"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_CONFIDENCE,
      "confidence must be LOW, MEDIUM, or HIGH",
    );
  }
  if (
    typeof row["incidentType"] !== "string" ||
    !isInvestigationIncidentType(row["incidentType"])
  ) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "incidentType is not an allowed classification",
    );
  }
  if (typeof row["severity"] !== "string" || !isExceptionSeverity(row["severity"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "severity must be INFO, WARNING, ERROR, or CRITICAL",
    );
  }
  rejectLossAndMutation(summary, "summary");
  rejectLossAndMutation(rootCause, "rootCause");
  rejectLossAndMutation(likelyCause, "likelyCause");
  rejectLossAndMutation(impact, "impact");
  const actions = parseActions(row);
  const result: InvestigationResult = {
    summary,
    facts: assertStringList(row["facts"], "facts", MAX_FACTS, MAX_FACT),
    evidence: parseEvidence(row["evidence"]),
    incidentType: row["incidentType"],
    severity: row["severity"],
    rootCause,
    likelyCause,
    impact,
    recommendedActions: actions.recommendedActions,
    recommendedAction: actions.recommendedAction,
    confidence: row["confidence"],
    confidenceReason,
    limitations: assertStringList(
      row["limitations"],
      "limitations",
      MAX_LIMITATIONS,
      MAX_FACT,
    ),
  };
  for (const fact of result.facts) {
    rejectLossAndMutation(fact, "facts");
  }
  if (
    result.incidentType === "INSUFFICIENT_EVIDENCE" &&
    result.rootCause !== INSUFFICIENT_EVIDENCE_ROOT_CAUSE
  ) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.MALFORMED_MODEL_OUTPUT,
      "INSUFFICIENT_EVIDENCE requires rootCause INSUFFICIENT EVIDENCE",
    );
  }
  return Object.freeze({
    ...result,
    facts: result.facts,
    evidence: result.evidence,
    recommendedActions: result.recommendedActions,
    recommendedAction: result.recommendedAction,
    limitations: result.limitations,
  });
}

export type NewInvestigationRecord = {
  readonly investigationId: string;
  readonly exceptionId: string;
  readonly investigator: string;
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly result: InvestigationResult;
  readonly createdAt: Instant;
  readonly correlationId: string;
};

export type InvestigationRecord = NewInvestigationRecord;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRELATION = /^[A-Za-z0-9._:~-]+$/;

export function createInvestigationRecord(
  input: NewInvestigationRecord,
): InvestigationRecord {
  if (!UUID.test(input.investigationId) || !UUID.test(input.exceptionId)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "investigationId and exceptionId must be UUIDs",
    );
  }
  if (input.correlationId.length === 0 || !CORRELATION.test(input.correlationId)) {
    throw new DomainError("INVALID_IDENTITY", "correlationId is invalid");
  }
  if (input.investigator.length === 0 || input.promptVersion.length === 0) {
    throw new DomainError(
      "INVALID_INVESTIGATION",
      "investigator and promptVersion are required",
    );
  }
  return Object.freeze({
    investigationId: input.investigationId,
    exceptionId: input.exceptionId,
    investigator: input.investigator,
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    result: createInvestigationResult(input.result),
    createdAt: instant(input.createdAt),
    correlationId: input.correlationId,
  });
}
