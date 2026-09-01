import { describe, expect, it } from "vitest";
import {
  FAILURE_LAB_EVENT_PREFIX,
  FAILURE_LAB_PAYMENT_LIKE,
  FAILURE_LAB_PAYMENT_PREFIX,
  isFailureLabEventId,
  isFailureLabPaymentId,
} from "./identity.js";

describe("Failure Lab identity filters", () => {
  it("matches only SYNTHETIC:pay:lab-* payment ids", () => {
    expect(isFailureLabPaymentId("SYNTHETIC:pay:lab-run-1")).toBe(true);
    expect(isFailureLabPaymentId("SYNTHETIC:pay:sim-duplicate")).toBe(false);
    expect(isFailureLabPaymentId("pay_live_razorpay")).toBe(false);
    expect(isFailureLabPaymentId("SYNTHETIC:pay:lab")).toBe(false);
    expect(isFailureLabPaymentId(null)).toBe(false);
    expect(FAILURE_LAB_PAYMENT_LIKE).toBe(`${FAILURE_LAB_PAYMENT_PREFIX}%`);
  });

  it("matches only SYNTHETIC:evt:lab-* event ids", () => {
    expect(isFailureLabEventId(`${FAILURE_LAB_EVENT_PREFIX}run-created`)).toBe(
      true,
    );
    expect(isFailureLabEventId("SYNTHETIC:evt:sim-duplicate-created")).toBe(
      false,
    );
  });
});
