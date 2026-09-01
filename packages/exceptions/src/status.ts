export const EXCEPTION_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export function isExceptionStatus(value: string): value is ExceptionStatus {
  return (EXCEPTION_STATUSES as readonly string[]).includes(value);
}

const FORWARD: Readonly<Record<ExceptionStatus, readonly ExceptionStatus[]>> =
  Object.freeze({
    OPEN: ["ACKNOWLEDGED", "RESOLVED"] as const,
    ACKNOWLEDGED: ["RESOLVED"] as const,
    RESOLVED: [] as const,
  });

export function canTransitionExceptionStatus(
  from: ExceptionStatus,
  to: ExceptionStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return FORWARD[from].includes(to);
}
