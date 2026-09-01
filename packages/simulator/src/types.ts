import type { PaymentState } from "@hookx/domain";
import type { SyntheticEventName, WebhookEventType } from "@hookx/webhook";

export const SCENARIO_ID = {
  NORMAL_FLOW: "NORMAL_FLOW",
  DUPLICATE_DELIVERY: "DUPLICATE_DELIVERY",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  CONFLICT: "CONFLICT",
  RETRY_FAILURE: "RETRY_FAILURE",
  PERMANENT_FAILURE: "PERMANENT_FAILURE",
  MULTI_PAYMENT: "MULTI_PAYMENT",
} as const;

export type ScenarioId = (typeof SCENARIO_ID)[keyof typeof SCENARIO_ID];

export const CLI_ALIAS: Readonly<Record<string, ScenarioId>> = Object.freeze({
  normal: SCENARIO_ID.NORMAL_FLOW,
  duplicate: SCENARIO_ID.DUPLICATE_DELIVERY,
  "out-of-order": SCENARIO_ID.OUT_OF_ORDER,
  conflict: SCENARIO_ID.CONFLICT,
  retry: SCENARIO_ID.RETRY_FAILURE,
  "dead-letter": SCENARIO_ID.PERMANENT_FAILURE,
  multi: SCENARIO_ID.MULTI_PAYMENT,
});

export type DeliveryKind = "SEND" | "RESEND_IDENTICAL" | "SEND_CONFLICTING";

export type DeliveryStep = {
  readonly kind: DeliveryKind;
  readonly eventKey: string;
};

export type ScenarioEventSpec = {
  readonly key: string;
  readonly paymentId: string;
  readonly eventType: WebhookEventType;
  readonly externalEventId: string;
  readonly bookedAt: string;
  readonly amountMinor: string;
  readonly conflictAmountMinor?: string;
  readonly currency: string;
  readonly kind: SyntheticEventName;
};

export type FailurePlan =
  | { readonly kind: "NONE" }
  | { readonly kind: "FAIL_THEN_SUCCEED"; readonly failAttempts: number }
  | { readonly kind: "EXHAUST_RETRIES" };

export type RetryDemoPolicy = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly ticksAfterDelivery: number;
};

export type ExpectedHttpOutcome = {
  readonly status: number;
  readonly bodyStatus: string;
  readonly code?: string;
};

export type ExpectedPayment = {
  readonly paymentId: string;
  readonly state: PaymentState | null;
};

export type ScenarioExpectation = {
  readonly http: readonly ExpectedHttpOutcome[];
  readonly storedEventCount: number;
  readonly stateTransitionCount: number;
  readonly payments: readonly ExpectedPayment[];
  readonly auditEventTypes: readonly string[];
  readonly delayedAuditCount: number;
  readonly retryStatus?: string;
  readonly retryMinAttempts?: number;
  readonly deadLettered: boolean;
  readonly resultLines: readonly string[];
};

export type ScenarioDefinition = {
  readonly id: ScenarioId;
  readonly description: string;
  readonly synthetic: true;
  readonly paymentIds: readonly string[];
  readonly events: readonly ScenarioEventSpec[];
  readonly delivery: readonly DeliveryStep[];
  readonly failure: FailurePlan;
  readonly retry: RetryDemoPolicy;
  readonly expected: ScenarioExpectation;
};

export const DEFAULT_RETRY_DEMO: RetryDemoPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
  ticksAfterDelivery: 0,
});
