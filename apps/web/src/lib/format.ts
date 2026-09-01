export function formatClock(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? iso;
}

export function isSyntheticRef(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return value === "SYNTHETIC" || value.startsWith("SYNTHETIC:");
}

export function blank(value: string | null | undefined): string {
  return value === null || value === undefined || value.length === 0 ? "—" : value;
}
