export const AUDIT_ACTORS = [
  "SYSTEM",
  "WEBHOOK_PROVIDER",
  "RETRY_WORKER",
  "OPERATOR",
] as const;

export type AuditActor = (typeof AUDIT_ACTORS)[number];

export function isAuditActor(value: string): value is AuditActor {
  return (AUDIT_ACTORS as readonly string[]).includes(value);
}
