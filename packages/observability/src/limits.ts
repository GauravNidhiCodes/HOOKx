export const INCIDENT_LIST_LIMIT = 200;
export const TIMELINE_DEFAULT_LIMIT = 80;
export const TIMELINE_MAX_LIMIT = 200;

export function clampTimelineLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return TIMELINE_DEFAULT_LIMIT;
  }
  return Math.min(value, TIMELINE_MAX_LIMIT);
}

export function clampTimelineOffset(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}
