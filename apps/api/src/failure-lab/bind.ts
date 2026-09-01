import { getScenario, SCENARIO_ID, type ScenarioDefinition } from "@hookx/simulator";
import {
  FAILURE_LAB_SCENARIO,
  type FailureLabScenarioId,
  type SyntheticFailureMode,
} from "./catalog.js";

export function simulatorScenarioForLab(
  id: FailureLabScenarioId,
): ScenarioDefinition {
  if (id === FAILURE_LAB_SCENARIO.DUPLICATE_DELIVERY) {
    return getScenario(SCENARIO_ID.DUPLICATE_DELIVERY);
  }
  if (
    id === FAILURE_LAB_SCENARIO.OUT_OF_ORDER ||
    id === FAILURE_LAB_SCENARIO.REPLAY_RECOVERY
  ) {
    return getScenario(SCENARIO_ID.OUT_OF_ORDER);
  }
  if (id === FAILURE_LAB_SCENARIO.CONFLICTING_EVENT) {
    return getScenario(SCENARIO_ID.CONFLICT);
  }
  if (id === FAILURE_LAB_SCENARIO.TRANSIENT_FAILURE) {
    return getScenario(SCENARIO_ID.RETRY_FAILURE);
  }
  return getScenario(SCENARIO_ID.PERMANENT_FAILURE);
}

export function failureModeForLab(id: FailureLabScenarioId): SyntheticFailureMode {
  if (id === FAILURE_LAB_SCENARIO.TRANSIENT_FAILURE) {
    return "FAIL_ONCE";
  }
  if (id === FAILURE_LAB_SCENARIO.RETRY_EXHAUSTION) {
    return "ALWAYS_FAIL";
  }
  return "NONE";
}

export function bindScenarioToLabRun(
  base: ScenarioDefinition,
  runId: string,
): ScenarioDefinition {
  const mappedPayments = base.paymentIds.map((_, index) => {
    const suffix = base.paymentIds.length === 1 ? "" : `-${String(index + 1)}`;
    return `SYNTHETIC:pay:lab-${runId}${suffix}`;
  });
  const paymentByOriginal = new Map(
    base.paymentIds.map((original, index) => [original, mappedPayments[index] ?? original]),
  );
  return {
    ...base,
    paymentIds: mappedPayments,
    events: base.events.map((event) => ({
      ...event,
      paymentId: paymentByOriginal.get(event.paymentId) ?? event.paymentId,
      externalEventId: event.externalEventId.replace(
        /^SYNTHETIC:evt:sim-/,
        `SYNTHETIC:evt:lab-${runId}-`,
      ),
    })),
    expected: {
      ...base.expected,
      payments: base.expected.payments.map((row, index) => ({
        ...row,
        paymentId: mappedPayments[index] ?? row.paymentId,
      })),
    },
  };
}
