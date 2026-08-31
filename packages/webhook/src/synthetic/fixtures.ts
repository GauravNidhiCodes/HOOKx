import {
  SYNTHETIC_EVENT_NAME,
  SYNTHETIC_PROVIDER_NAME,
  type SyntheticEventName,
  type SyntheticWebhookPayload,
} from "./payload.js";

export const SYNTHETIC_RECEIVED_AT = "2026-01-15T10:00:01.000Z";
export const SYNTHETIC_OCCURRED_AT = "2026-01-15T10:00:00.000Z";
export const SYNTHETIC_AMOUNT_MINOR_STRING = "10000";
export const SYNTHETIC_MARKER = "SYNTHETIC" as const;

export interface SyntheticPayloadOverride {
  readonly event_ref?: string;
  readonly kind?: string;
  readonly payment_ref?: string;
  readonly booked_at?: string;
  readonly minor_units?: string;
  readonly ccy?: string;
}

export function syntheticProviderPayload(
  kind: SyntheticEventName,
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  const suffix = kind.replaceAll(".", "-");
  return Object.freeze({
    infrastructure: SYNTHETIC_PROVIDER_NAME,
    event_ref: overrides.event_ref ?? `${SYNTHETIC_MARKER}:evt:${suffix}`,
    kind: overrides.kind ?? kind,
    entity: Object.freeze({
      payment_ref: overrides.payment_ref ?? `${SYNTHETIC_MARKER}:pay:001`,
      booked_at: overrides.booked_at ?? SYNTHETIC_OCCURRED_AT,
      money: Object.freeze({
        minor_units: overrides.minor_units ?? SYNTHETIC_AMOUNT_MINOR_STRING,
        ccy: overrides.ccy ?? "INR",
      }),
    }),
  });
}

export function syntheticOpenedPayload(
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_OPENED, overrides);
}

export function syntheticHoldPayload(
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_HOLD, overrides);
}

export function syntheticSettledPayload(
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_SETTLED, overrides);
}

export function syntheticDeclinedPayload(
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_DECLINED, overrides);
}

export function syntheticReturnPayload(
  overrides: SyntheticPayloadOverride = {},
): SyntheticWebhookPayload {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_RETURN, overrides);
}

export function malformedSyntheticPayload(): unknown {
  return Object.freeze(["SYNTHETIC", "malformed-envelope"]);
}

export function unknownSyntheticEventPayload(): unknown {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_OPENED, {
    kind: "syn.payment.reversed",
  });
}

export function invalidAmountSyntheticPayload(): unknown {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_OPENED, {
    minor_units: "10.50",
  });
}

export function invalidCurrencySyntheticPayload(): unknown {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_OPENED, {
    ccy: "rupees",
  });
}

export function invalidTimestampSyntheticPayload(): unknown {
  return syntheticProviderPayload(SYNTHETIC_EVENT_NAME.PAYMENT_OPENED, {
    booked_at: "15 Jan 2026",
  });
}

export function numericAmountSyntheticPayload(): unknown {
  const base = syntheticOpenedPayload();
  return {
    infrastructure: base.infrastructure,
    event_ref: base.event_ref,
    kind: base.kind,
    entity: {
      payment_ref: base.entity.payment_ref,
      booked_at: base.entity.booked_at,
      money: {
        minor_units: 10000,
        ccy: "INR",
      },
    },
  };
}

export function duplicateIdenticalSyntheticPayloads(): readonly [
  SyntheticWebhookPayload,
  SyntheticWebhookPayload,
] {
  const eventRef = `${SYNTHETIC_MARKER}:evt:duplicate-identical`;
  return [
    syntheticOpenedPayload({ event_ref: eventRef }),
    syntheticOpenedPayload({ event_ref: eventRef }),
  ];
}

export function duplicateConflictingSyntheticPayloads(): readonly [
  SyntheticWebhookPayload,
  SyntheticWebhookPayload,
] {
  const eventRef = `${SYNTHETIC_MARKER}:evt:duplicate-conflict`;
  return [
    syntheticOpenedPayload({ event_ref: eventRef, minor_units: "10000" }),
    syntheticOpenedPayload({ event_ref: eventRef, minor_units: "25000" }),
  ];
}

export const SYNTHETIC_PROVIDER_PAYLOADS = {
  "payment.created": syntheticOpenedPayload,
  "payment.authorized": syntheticHoldPayload,
  "payment.captured": syntheticSettledPayload,
  "payment.failed": syntheticDeclinedPayload,
  "refund.created": syntheticReturnPayload,
  malformed: malformedSyntheticPayload,
  unknownEvent: unknownSyntheticEventPayload,
  invalidAmount: invalidAmountSyntheticPayload,
  invalidCurrency: invalidCurrencySyntheticPayload,
  invalidTimestamp: invalidTimestampSyntheticPayload,
  duplicateIdentical: duplicateIdenticalSyntheticPayloads,
  duplicateConflicting: duplicateConflictingSyntheticPayloads,
} as const;
