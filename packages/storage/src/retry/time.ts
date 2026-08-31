import { instant, type Instant } from "@hookx/domain";

/**
 * Add milliseconds to an injected instant. Uses the instant string, not Date.now().
 */
export function addMilliseconds(value: Instant, milliseconds: number): Instant {
  if (!Number.isInteger(milliseconds)) {
    throw new Error("Duration must be an integer number of milliseconds");
  }
  const next = Date.parse(value) + milliseconds;
  if (!Number.isFinite(next)) {
    throw new Error("Duration overflow");
  }
  return instant(new Date(next).toISOString());
}
