/**
 * In-process Failure Lab / Golden Demo reports are retained for GET-by-id.
 * Bound the Map so a long-lived API process cannot accumulate unbounded runs.
 */
export const LAB_RUN_RETENTION = 50;

export function retainLabRuns<T>(
  runs: Map<string, T>,
  max = LAB_RUN_RETENTION,
): void {
  if (max <= 0) {
    runs.clear();
    return;
  }
  while (runs.size > max) {
    const oldest = runs.keys().next();
    if (oldest.done) {
      return;
    }
    runs.delete(oldest.value);
  }
}
