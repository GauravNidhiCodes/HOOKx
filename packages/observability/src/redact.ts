import { isLifecycleEvent, type LifecycleEvent } from "./lifecycle.js";
import { isLogLevel, type LogLevel } from "./levels.js";

export const SENSITIVE_KEY =
  /(secret|signature|password|authorization|credential|payload|token|cookie|rawbody|apikey|api_key|x-api-key)/i;

const MAX_STRING_LENGTH = 128;

export const LOG_FIELD_ALLOWLIST = [
  "timestamp",
  "level",
  "message",
  "correlationId",
  "provider",
  "eventId",
  "paymentId",
  "eventType",
  "processingDecision",
  "exceptionCode",
  "lifecycle",
  "attempt",
  "storeOutcome",
  "verification",
  "replayId",
  "previousState",
  "resultingState",
  "failureClass",
  "scheduledAt",
  "attemptedAt",
  "trigger",
  "eventsConsidered",
] as const;

export type LogFieldName = (typeof LOG_FIELD_ALLOWLIST)[number];

const ALLOWED = new Set<string>(LOG_FIELD_ALLOWLIST);

export type StructuredLogRecord = {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly correlationId?: string;
  readonly provider?: string | null;
  readonly eventId?: string | null;
  readonly paymentId?: string | null;
  readonly eventType?: string | null;
  readonly processingDecision?: string | null;
  readonly exceptionCode?: string | null;
  readonly lifecycle?: LifecycleEvent;
  readonly attempt?: number;
  readonly storeOutcome?: string;
  readonly verification?: string;
  readonly replayId?: string;
  readonly previousState?: string | null;
  readonly resultingState?: string | null;
  readonly failureClass?: string;
  readonly scheduledAt?: string;
  readonly attemptedAt?: string;
  readonly trigger?: string;
  readonly eventsConsidered?: number;
};

function allowedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > MAX_STRING_LENGTH) {
    return undefined;
  }
  return value;
}

function allowedNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || Number.isNaN(value)) {
    return undefined;
  }
  return value;
}

/**
 * Keep only operational fields. Secrets, signatures, raw payloads, and
 * arbitrary objects are dropped — never redacted-in-place as "****".
 */
export function sanitizeLogFields(
  input: Readonly<Record<string, unknown>> | undefined,
): Omit<StructuredLogRecord, "timestamp" | "level" | "message"> {
  if (input === undefined) {
    return {};
  }
  const cleaned: Record<string, string | number | boolean | null | LifecycleEvent> =
    {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key) || !ALLOWED.has(key)) {
      continue;
    }
    if (key === "lifecycle") {
      if (typeof value === "string" && isLifecycleEvent(value)) {
        cleaned[key] = value;
      }
      continue;
    }
    if (key === "level" && typeof value === "string" && isLogLevel(value)) {
      continue;
    }
    if (
      key === "attempt" ||
      key === "eventsConsidered"
    ) {
      const numeric = allowedNumber(value);
      if (numeric !== undefined && Number.isInteger(numeric) && numeric >= 0) {
        cleaned[key] = numeric;
      }
      continue;
    }
    const asString = allowedString(value);
    if (asString !== undefined) {
      cleaned[key] = asString;
    }
  }
  return cleaned;
}

export function recordContainsSensitiveData(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return false;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => recordContainsSensitiveData(item));
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      return true;
    }
    if (recordContainsSensitiveData(nested)) {
      return true;
    }
  }
  return false;
}
