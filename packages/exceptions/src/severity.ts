import type { ExceptionCode } from "./codes.js";

export const EXCEPTION_SEVERITIES = [
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
] as const;

export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export function isExceptionSeverity(value: string): value is ExceptionSeverity {
  return (EXCEPTION_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Severity is a pure function of exception code. It is never chosen by an LLM
 * or by operator preference at detection time.
 *
 * INFO     — valid duplicate delivery; no payment mutation
 * WARNING  — recoverable sequencing/support gaps that remain stored
 * ERROR    — security, conflict, invalid domain, or processing failure
 * CRITICAL — retry budget exhausted; the event still exists and needs attention
 */
export const EXCEPTION_SEVERITY_BY_CODE: Readonly<
  Record<ExceptionCode, ExceptionSeverity>
> = Object.freeze({
  DUPLICATE_EVENT: "INFO",
  OUT_OF_ORDER_EVENT: "WARNING",
  MISSING_EVENT: "WARNING",
  UNSUPPORTED_EVENT: "WARNING",
  MALFORMED_WEBHOOK: "ERROR",
  INVALID_SIGNATURE: "ERROR",
  CONFLICTING_EVENT: "ERROR",
  INVALID_STATE_TRANSITION: "ERROR",
  PROCESSING_FAILURE: "ERROR",
  RETRY_EXHAUSTED: "CRITICAL",
});

export function severityForExceptionCode(code: ExceptionCode): ExceptionSeverity {
  return EXCEPTION_SEVERITY_BY_CODE[code];
}
