import { describe, expect, it } from "vitest";
import { PAYMENT_STATES, isPaymentState } from "./payment-state.js";

describe("payment state model", () => {
  it("exposes the explicit lifecycle", () => {
    expect(PAYMENT_STATES).toEqual([
      "CREATED",
      "AUTHORIZED",
      "CAPTURED",
      "FAILED",
      "REFUNDED",
    ]);
  });

  it("does not treat unknown labels as states", () => {
    expect(isPaymentState("CREATED")).toBe(true);
    expect(isPaymentState("PENDING")).toBe(false);
    expect(isPaymentState("created")).toBe(false);
  });
});
