import { describe, expect, it } from "vitest";
import { CLI_ALIAS, SCENARIO_ID } from "./types.js";
import { SCENARIOS, getScenario, resolveScenarioRef } from "./catalog.js";

describe("scenario catalog", () => {
  it("defines every required scenario with synthetic: true", () => {
    const ids = SCENARIOS.map((row) => row.id);
    expect(ids).toEqual([
      SCENARIO_ID.NORMAL_FLOW,
      SCENARIO_ID.DUPLICATE_DELIVERY,
      SCENARIO_ID.OUT_OF_ORDER,
      SCENARIO_ID.CONFLICT,
      SCENARIO_ID.RETRY_FAILURE,
      SCENARIO_ID.PERMANENT_FAILURE,
      SCENARIO_ID.MULTI_PAYMENT,
    ]);
    expect(SCENARIOS.every((row) => row.synthetic === true)).toBe(true);
  });

  it("keeps independent expected outcomes on the scenario, not computed later", () => {
    const normal = getScenario(SCENARIO_ID.NORMAL_FLOW);
    expect(normal.expected.payments[0]?.state).toBe("CAPTURED");
    expect(normal.expected.http).toHaveLength(3);
    expect(normal.delivery.map((step) => step.eventKey)).toEqual([
      "created",
      "authorized",
      "captured",
    ]);

    const duplicate = getScenario(SCENARIO_ID.DUPLICATE_DELIVERY);
    expect(duplicate.expected.storedEventCount).toBe(1);
    expect(duplicate.expected.stateTransitionCount).toBe(1);

    const outOfOrder = getScenario(SCENARIO_ID.OUT_OF_ORDER);
    expect(outOfOrder.delivery.map((step) => step.eventKey)).toEqual([
      "created",
      "captured",
      "authorized",
    ]);
    expect(outOfOrder.expected.payments[0]?.state).toBe("CAPTURED");
    expect(outOfOrder.expected.delayedAuditCount).toBe(1);

    const conflict = getScenario(SCENARIO_ID.CONFLICT);
    expect(conflict.delivery[1]?.kind).toBe("SEND_CONFLICTING");
    expect(conflict.expected.http[1]?.status).toBe(409);

    const retry = getScenario(SCENARIO_ID.RETRY_FAILURE);
    expect(retry.failure).toEqual({ kind: "FAIL_THEN_SUCCEED", failAttempts: 1 });
    expect(retry.retry.ticksAfterDelivery).toBe(1);

    const dead = getScenario(SCENARIO_ID.PERMANENT_FAILURE);
    expect(dead.failure.kind).toBe("EXHAUST_RETRIES");
    expect(dead.retry.maxAttempts).toBe(2);
    expect(dead.expected.deadLettered).toBe(true);
    expect(dead.expected.stateTransitionCount).toBe(0);

    const multi = getScenario(SCENARIO_ID.MULTI_PAYMENT);
    expect(multi.paymentIds).toEqual([
      "SYNTHETIC:pay:sim-multi-a",
      "SYNTHETIC:pay:sim-multi-b",
    ]);
    expect(multi.delivery.map((step) => step.eventKey)).toEqual([
      "a-created",
      "b-created",
      "a-authorized",
      "b-authorized",
      "a-captured",
      "b-captured",
    ]);
  });

  it("resolves CLI aliases without randomness", () => {
    expect(resolveScenarioRef("normal").id).toBe(SCENARIO_ID.NORMAL_FLOW);
    expect(resolveScenarioRef("out-of-order").id).toBe(SCENARIO_ID.OUT_OF_ORDER);
    expect(resolveScenarioRef("dead-letter").id).toBe(
      SCENARIO_ID.PERMANENT_FAILURE,
    );
    expect(Object.keys(CLI_ALIAS)).toEqual([
      "normal",
      "duplicate",
      "out-of-order",
      "conflict",
      "retry",
      "dead-letter",
      "multi",
    ]);
  });
});
