import { describe, expect, it } from "vitest";
import { isEventuallyPossible, reachableStates } from "./reachability.js";

describe("isEventuallyPossible", () => {
  it("treats CREATED + payment.captured as eventually possible via AUTHORIZED", () => {
    expect(isEventuallyPossible("CREATED", "payment.captured")).toBe(true);
    expect(reachableStates("CREATED").has("AUTHORIZED")).toBe(true);
  });

  it("treats FAILED + payment.captured as impossible", () => {
    expect(isEventuallyPossible("FAILED", "payment.captured")).toBe(false);
    expect([...reachableStates("FAILED")]).toEqual(["FAILED"]);
  });

  it("treats a missing created event as a delay, not an impossibility", () => {
    expect(isEventuallyPossible(null, "payment.authorized")).toBe(true);
    expect(isEventuallyPossible(null, "payment.captured")).toBe(true);
  });

  it("does not walk backwards from CAPTURED to AUTHORIZED", () => {
    expect(isEventuallyPossible("CAPTURED", "payment.authorized")).toBe(false);
  });
});
