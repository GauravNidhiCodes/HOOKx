import { DomainError, instant, type Instant } from "@hookx/domain";
import {
  isInvestigationConfidence,
  type InvestigationConfidence,
} from "./confidence.js";
import type { InvestigationEvidence } from "./evidence.js";
import { isEvidenceSourceType } from "./evidence.js";
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
  readonly likelyCause: string;
  readonly recommendedAction: RecommendedAction;
  readonly confidence: InvestigationConfidence;
  readonly limitations: readonly string[];
};

const MAX_SUMMARY = 2_000;
const MAX_CAUSE = 2_000;
const MAX_FACT = 500;
const MAX_FACTS = 16;
const MAX_EVIDENCE = 16;
const MAX_LIMITATIONS = 12;
const PRINTABLE = /^[\u0020-\u007E\n]+$/;

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

function parseAction(value: unknown): RecommendedAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      "recommendedAction must be an object",
    );
  }
  const row = value as Record<string, unknown>;
  if (typeof row["code"] !== "string" || !isRecommendedActionCode(row["code"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      "recommendedAction.code is not an allowed advisory code",
    );
  }
  const detail = assertText(row["detail"], "recommendedAction.detail", MAX_FACT);
  if (isForbiddenFinancialAction(detail) || isForbiddenFinancialAction(row["code"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      "recommendedAction must not mutate financial state",
    );
  }
  return Object.freeze({
    code: row["code"],
    detail,
    executable: false,
  });
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
  const likelyCause = assertText(row["likelyCause"], "likelyCause", MAX_CAUSE);
  if (typeof row["confidence"] !== "string" || !isInvestigationConfidence(row["confidence"])) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_CONFIDENCE,
      "confidence must be LOW, MEDIUM, or HIGH",
    );
  }
  if (isForbiddenFinancialAction(summary) || isForbiddenFinancialAction(likelyCause)) {
    throw new InvestigationError(
      INVESTIGATION_ERROR_CODE.INVALID_RECOMMENDATION,
      "investigation text must not prescribe financial mutation",
    );
  }
  const result: InvestigationResult = {
    summary,
    facts: assertStringList(row["facts"], "facts", MAX_FACTS, MAX_FACT),
    evidence: parseEvidence(row["evidence"]),
    likelyCause,
    recommendedAction: parseAction(row["recommendedAction"]),
    confidence: row["confidence"],
    limitations: assertStringList(
      row["limitations"],
      "limitations",
      MAX_LIMITATIONS,
      MAX_FACT,
    ),
  };
  return Object.freeze({
    ...result,
    facts: result.facts,
    evidence: result.evidence,
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
