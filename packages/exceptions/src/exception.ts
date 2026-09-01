import {
  DomainError,
  instant,
  paymentId,
  providerId,
  type Instant,
  type PaymentId,
  type ProviderId,
} from "@hookx/domain";
import {
  sanitizeAuditMetadata,
  type AuditMetadata,
} from "@hookx/audit";
import { isExceptionCode, type ExceptionCode } from "./codes.js";
import { exceptionIdentity } from "./identity.js";
import {
  isExceptionSeverity,
  severityForExceptionCode,
  type ExceptionSeverity,
} from "./severity.js";
import { isExceptionStatus, type ExceptionStatus } from "./status.js";

export type ExceptionMetadata = AuditMetadata;

export type ExceptionDraftInput = {
  readonly exceptionCode: ExceptionCode;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly provider: ProviderId | null;
  readonly reason: string;
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type ExceptionDraft = {
  readonly exceptionCode: ExceptionCode;
  readonly severity: ExceptionSeverity;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly provider: ProviderId | null;
  readonly status: "OPEN";
  readonly reason: string;
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly metadata: ExceptionMetadata;
  readonly identity: string;
};

export type NewExceptionRecord = ExceptionDraftInput & {
  readonly exceptionId: string;
  readonly status?: ExceptionStatus;
  readonly severity?: ExceptionSeverity;
  readonly identity?: string;
};

export type ExceptionRecord = {
  readonly exceptionId: string;
  readonly exceptionCode: ExceptionCode;
  readonly severity: ExceptionSeverity;
  readonly paymentId: PaymentId | null;
  readonly webhookEventId: string | null;
  readonly provider: ProviderId | null;
  readonly status: ExceptionStatus;
  readonly reason: string;
  readonly detectedAt: Instant;
  readonly correlationId: string;
  readonly metadata: ExceptionMetadata;
  readonly identity: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRELATION = /^[A-Za-z0-9._:~-]+$/;
const REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

function assertCorrelationId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "correlationId must be a non-empty trimmed identifier",
    );
  }
  if (!CORRELATION.test(value)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "correlationId may contain only A-Z, a-z, 0-9, and . _ : ~ -",
    );
  }
  return value;
}

function assertOptionalUuid(value: string | null, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (!UUID.test(value)) {
    throw new DomainError("INVALID_IDENTITY", `${label} must be a UUID`);
  }
  return value;
}

function assertReason(value: string): string {
  if (!REASON.test(value)) {
    throw new DomainError(
      "INVALID_EXCEPTION",
      "reason must be a structured A-Z0-9_ code",
    );
  }
  return value;
}

function freezeRecord(record: ExceptionRecord): ExceptionRecord {
  return Object.freeze({
    ...record,
    metadata: Object.freeze({ ...record.metadata }),
  });
}

export function createExceptionDraft(input: ExceptionDraftInput): ExceptionDraft {
  if (!isExceptionCode(input.exceptionCode)) {
    throw new DomainError("INVALID_EXCEPTION", "Unknown exception code");
  }
  const webhookEventId = assertOptionalUuid(
    input.webhookEventId,
    "webhookEventId",
  );
  const payment =
    input.paymentId === null ? null : paymentId(input.paymentId);
  const correlationId = assertCorrelationId(input.correlationId);
  const draft: ExceptionDraft = {
    exceptionCode: input.exceptionCode,
    severity: severityForExceptionCode(input.exceptionCode),
    paymentId: payment,
    webhookEventId,
    provider: input.provider === null ? null : providerId(input.provider),
    status: "OPEN",
    reason: assertReason(input.reason),
    detectedAt: instant(input.detectedAt),
    correlationId,
    metadata: sanitizeAuditMetadata(input.metadata),
    identity: exceptionIdentity({
      exceptionCode: input.exceptionCode,
      paymentId: payment,
      webhookEventId,
      correlationId,
    }),
  };
  return Object.freeze({
    ...draft,
    metadata: Object.freeze({ ...draft.metadata }),
  });
}

export function createException(input: NewExceptionRecord): ExceptionRecord {
  if (!UUID.test(input.exceptionId)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      "exceptionId must be a UUID assigned at the persistence boundary",
    );
  }
  const draft = createExceptionDraft(input);
  const status = input.status ?? "OPEN";
  if (!isExceptionStatus(status)) {
    throw new DomainError("INVALID_EXCEPTION", "Unknown exception status");
  }
  const severity = input.severity ?? draft.severity;
  if (!isExceptionSeverity(severity)) {
    throw new DomainError("INVALID_EXCEPTION", "Unknown exception severity");
  }
  if (severity !== draft.severity) {
    throw new DomainError(
      "INVALID_EXCEPTION",
      "severity must match the exception code",
    );
  }
  return freezeRecord({
    exceptionId: input.exceptionId,
    ...draft,
    status,
    identity: input.identity ?? draft.identity,
  });
}
