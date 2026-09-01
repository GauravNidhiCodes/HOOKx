import type { PaymentState } from "@hookx/domain";
import { SYNTHETIC_EVENT_NAME } from "@hookx/webhook";
import {
  DEFAULT_RETRY_DEMO,
  SCENARIO_ID,
  type DeliveryStep,
  type ExpectedPayment,
  type ScenarioDefinition,
} from "./types.js";

function expectPayment(
  paymentId: string,
  state: PaymentState | null,
): ExpectedPayment {
  return Object.freeze({ paymentId, state });
}

function send(eventKey: string): DeliveryStep {
  return Object.freeze({ kind: "SEND", eventKey });
}

function resend(eventKey: string): DeliveryStep {
  return Object.freeze({ kind: "RESEND_IDENTICAL", eventKey });
}

function conflict(eventKey: string): DeliveryStep {
  return Object.freeze({ kind: "SEND_CONFLICTING", eventKey });
}

const T0 = "2026-01-15T10:00:00.000Z";
const T1 = "2026-01-15T10:00:01.000Z";
const T2 = "2026-01-15T10:00:02.000Z";
const AMOUNT = "10000";
const CURRENCY = "INR";

function event(
  key: string,
  paymentId: string,
  eventType: ScenarioDefinition["events"][number]["eventType"],
  kind: ScenarioDefinition["events"][number]["kind"],
  bookedAt: string,
  suffix: string,
  extra: { readonly conflictAmountMinor?: string } = {},
): ScenarioDefinition["events"][number] {
  return Object.freeze({
    key,
    paymentId,
    eventType,
    externalEventId: `SYNTHETIC:evt:sim-${suffix}`,
    bookedAt,
    amountMinor: AMOUNT,
    currency: CURRENCY,
    kind,
    ...extra,
  });
}

export const NORMAL_FLOW: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.NORMAL_FLOW,
  description:
    "Happy path: created, then authorized, then captured. Synthetic only.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-normal"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-normal",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "normal-created",
    ),
    event(
      "authorized",
      "SYNTHETIC:pay:sim-normal",
      "payment.authorized",
      SYNTHETIC_EVENT_NAME.PAYMENT_HOLD,
      T1,
      "normal-authorized",
    ),
    event(
      "captured",
      "SYNTHETIC:pay:sim-normal",
      "payment.captured",
      SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED,
      T2,
      "normal-captured",
    ),
  ]),
  delivery: Object.freeze([
    send("created"),
    send("authorized"),
    send("captured"),
  ]),
  failure: Object.freeze({ kind: "NONE" }),
  retry: DEFAULT_RETRY_DEMO,
  expected: Object.freeze({
    http: Object.freeze([
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
    ]),
    storedEventCount: 3,
    stateTransitionCount: 3,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-normal", "CAPTURED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
    ]),
    delayedAuditCount: 0,
    deadLettered: false,
    resultLines: Object.freeze([
      "created accepted",
      "authorized accepted",
      "captured accepted",
      "final state: CAPTURED",
    ]),
  }),
});

export const DUPLICATE_DELIVERY: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.DUPLICATE_DELIVERY,
  description:
    "The same created webhook is delivered twice. One stored event, one transition.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-duplicate"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-duplicate",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "duplicate-created",
    ),
  ]),
  delivery: Object.freeze([send("created"), resend("created")]),
  failure: Object.freeze({ kind: "NONE" }),
  retry: DEFAULT_RETRY_DEMO,
  expected: Object.freeze({
    http: Object.freeze([
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "duplicate" },
    ]),
    storedEventCount: 1,
    stateTransitionCount: 1,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-duplicate", "CREATED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
      "WEBHOOK_DUPLICATE",
    ]),
    delayedAuditCount: 0,
    deadLettered: false,
    resultLines: Object.freeze([
      "first created accepted",
      "second created classified duplicate",
      "stored economic events: 1",
      "state transitions: 1",
      "final state: CREATED",
    ]),
  }),
});

export const OUT_OF_ORDER: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.OUT_OF_ORDER,
  description:
    "Capture arrives before authorization. Replay must resolve to CAPTURED.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-out-of-order"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-out-of-order",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "ooo-created",
    ),
    event(
      "captured",
      "SYNTHETIC:pay:sim-out-of-order",
      "payment.captured",
      SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED,
      T2,
      "ooo-captured",
    ),
    event(
      "authorized",
      "SYNTHETIC:pay:sim-out-of-order",
      "payment.authorized",
      SYNTHETIC_EVENT_NAME.PAYMENT_HOLD,
      T1,
      "ooo-authorized",
    ),
  ]),
  delivery: Object.freeze([
    send("created"),
    send("captured"),
    send("authorized"),
  ]),
  failure: Object.freeze({ kind: "NONE" }),
  retry: DEFAULT_RETRY_DEMO,
  expected: Object.freeze({
    http: Object.freeze([
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
    ]),
    storedEventCount: 3,
    stateTransitionCount: 2,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-out-of-order", "CAPTURED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
      "WEBHOOK_DELAYED",
    ]),
    delayedAuditCount: 1,
    deadLettered: false,
    resultLines: Object.freeze([
      "captured initially delayed",
      "authorized accepted",
      "replay resolved captured",
      "final state: CAPTURED",
    ]),
  }),
});

export const CONFLICT: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.CONFLICT,
  description:
    "Same external event ID with a materially different amount. Original is kept.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-conflict"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-conflict",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "conflict-created",
      { conflictAmountMinor: "25000" },
    ),
  ]),
  delivery: Object.freeze([send("created"), conflict("created")]),
  failure: Object.freeze({ kind: "NONE" }),
  retry: DEFAULT_RETRY_DEMO,
  expected: Object.freeze({
    http: Object.freeze([
      { status: 200, bodyStatus: "accepted" },
      { status: 409, bodyStatus: "conflict", code: "CONFLICT" },
    ]),
    storedEventCount: 1,
    stateTransitionCount: 1,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-conflict", "CREATED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
      "WEBHOOK_CONFLICT",
    ]),
    delayedAuditCount: 0,
    deadLettered: false,
    resultLines: Object.freeze([
      "original created accepted",
      "conflicting payload rejected",
      "original event unchanged",
      "final state: CREATED",
    ]),
  }),
});

export const RETRY_FAILURE: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.RETRY_FAILURE,
  description:
    "First processing attempt fails temporarily. The second attempt succeeds.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-retry"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-retry",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "retry-created",
    ),
  ]),
  delivery: Object.freeze([send("created")]),
  failure: Object.freeze({ kind: "FAIL_THEN_SUCCEED", failAttempts: 1 }),
  retry: Object.freeze({
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    ticksAfterDelivery: 1,
  }),
  expected: Object.freeze({
    http: Object.freeze([
      {
        status: 500,
        bodyStatus: "error",
        code: "TEMPORARY_PROCESSING_FAILURE",
      },
    ]),
    storedEventCount: 1,
    stateTransitionCount: 1,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-retry", "CREATED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "RETRY_SCHEDULED",
      "RETRY_ATTEMPTED",
      "PAYMENT_STATE_CHANGED",
      "RETRY_SUCCEEDED",
    ]),
    delayedAuditCount: 0,
    retryStatus: "SUCCEEDED",
    retryMinAttempts: 2,
    deadLettered: false,
    resultLines: Object.freeze([
      "first attempt temporary failure",
      "retry scheduled",
      "second attempt succeeded",
      "final state: CREATED",
    ]),
  }),
});

export const PERMANENT_FAILURE: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.PERMANENT_FAILURE,
  description:
    "Every processing attempt fails until max attempts, then the event is dead-lettered.",
  synthetic: true,
  paymentIds: Object.freeze(["SYNTHETIC:pay:sim-dead-letter"]),
  events: Object.freeze([
    event(
      "created",
      "SYNTHETIC:pay:sim-dead-letter",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "dead-created",
    ),
  ]),
  delivery: Object.freeze([send("created")]),
  failure: Object.freeze({ kind: "EXHAUST_RETRIES" }),
  retry: Object.freeze({
    maxAttempts: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    ticksAfterDelivery: 1,
  }),
  expected: Object.freeze({
    http: Object.freeze([
      {
        status: 500,
        bodyStatus: "error",
        code: "TEMPORARY_PROCESSING_FAILURE",
      },
    ]),
    storedEventCount: 1,
    stateTransitionCount: 0,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-dead-letter", null),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "RETRY_SCHEDULED",
      "RETRY_ATTEMPTED",
      "RETRY_DEAD_LETTERED",
    ]),
    delayedAuditCount: 0,
    retryStatus: "DEAD_LETTERED",
    retryMinAttempts: 2,
    deadLettered: true,
    resultLines: Object.freeze([
      "processing failed on every attempt",
      "retries stopped at max attempts",
      "event dead-lettered",
      "original webhook event preserved",
    ]),
  }),
});

export const MULTI_PAYMENT: ScenarioDefinition = Object.freeze({
  id: SCENARIO_ID.MULTI_PAYMENT,
  description:
    "Two independent synthetic payments with interleaved events. Isolation required.",
  synthetic: true,
  paymentIds: Object.freeze([
    "SYNTHETIC:pay:sim-multi-a",
    "SYNTHETIC:pay:sim-multi-b",
  ]),
  events: Object.freeze([
    event(
      "a-created",
      "SYNTHETIC:pay:sim-multi-a",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "multi-a-created",
    ),
    event(
      "b-created",
      "SYNTHETIC:pay:sim-multi-b",
      "payment.created",
      SYNTHETIC_EVENT_NAME.PAYMENT_OPENED,
      T0,
      "multi-b-created",
    ),
    event(
      "a-authorized",
      "SYNTHETIC:pay:sim-multi-a",
      "payment.authorized",
      SYNTHETIC_EVENT_NAME.PAYMENT_HOLD,
      T1,
      "multi-a-authorized",
    ),
    event(
      "b-authorized",
      "SYNTHETIC:pay:sim-multi-b",
      "payment.authorized",
      SYNTHETIC_EVENT_NAME.PAYMENT_HOLD,
      T1,
      "multi-b-authorized",
    ),
    event(
      "a-captured",
      "SYNTHETIC:pay:sim-multi-a",
      "payment.captured",
      SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED,
      T2,
      "multi-a-captured",
    ),
    event(
      "b-captured",
      "SYNTHETIC:pay:sim-multi-b",
      "payment.captured",
      SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED,
      T2,
      "multi-b-captured",
    ),
  ]),
  delivery: Object.freeze([
    send("a-created"),
    send("b-created"),
    send("a-authorized"),
    send("b-authorized"),
    send("a-captured"),
    send("b-captured"),
  ]),
  failure: Object.freeze({ kind: "NONE" }),
  retry: DEFAULT_RETRY_DEMO,
  expected: Object.freeze({
    http: Object.freeze([
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
      { status: 200, bodyStatus: "accepted" },
    ]),
    storedEventCount: 6,
    stateTransitionCount: 6,
    payments: Object.freeze([
      expectPayment("SYNTHETIC:pay:sim-multi-a", "CAPTURED"),
      expectPayment("SYNTHETIC:pay:sim-multi-b", "CAPTURED"),
    ]),
    auditEventTypes: Object.freeze([
      "WEBHOOK_RECEIVED",
      "PAYMENT_STATE_CHANGED",
    ]),
    delayedAuditCount: 0,
    deadLettered: false,
    resultLines: Object.freeze([
      "payment A isolated from payment B",
      "interleaved delivery preserved",
      "payment A final state: CAPTURED",
      "payment B final state: CAPTURED",
    ]),
  }),
});
