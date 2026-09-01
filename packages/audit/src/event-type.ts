export const AUDIT_EVENT_TYPES = [
  "WEBHOOK_RECEIVED",
  "WEBHOOK_REJECTED",
  "WEBHOOK_DUPLICATE",
  "WEBHOOK_CONFLICT",
  "PAYMENT_STATE_CHANGED",
  "WEBHOOK_DELAYED",
  "RETRY_SCHEDULED",
  "RETRY_ATTEMPTED",
  "RETRY_SUCCEEDED",
  "RETRY_DEAD_LETTERED",
  "EXCEPTION_DETECTED",
  "EXCEPTION_STATUS_CHANGED",
  "WEBHOOK_CONFLICT_DETECTED",
  "INVALID_TRANSITION_DETECTED",
  "RETRY_EXHAUSTED",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export function isAuditEventType(value: string): value is AuditEventType {
  return (AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}
