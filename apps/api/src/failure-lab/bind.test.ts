import { describe, expect, it } from "vitest";
import { getScenario, SCENARIO_ID } from "@hookx/simulator";
import { isFailureLabPaymentId } from "@hookx/storage";
import { bindScenarioToLabRun } from "./bind.js";

describe("bindScenarioToLabRun", () => {
  it("rewrites payments and events onto the Failure Lab prefix", () => {
    const bound = bindScenarioToLabRun(
      getScenario(SCENARIO_ID.DUPLICATE_DELIVERY),
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(bound.paymentIds[0]).toBe(
      "SYNTHETIC:pay:lab-dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(isFailureLabPaymentId(bound.paymentIds[0] ?? "")).toBe(true);
    expect(bound.events[0]?.externalEventId.startsWith("SYNTHETIC:evt:lab-")).toBe(
      true,
    );
    expect(bound.events[0]?.externalEventId).not.toContain(":sim-");
  });
});
