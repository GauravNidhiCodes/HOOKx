/**
 * Synthetic Razorpay webhook fixtures shaped after current official samples.
 * https://razorpay.com/docs/webhooks/payments/
 * https://razorpay.com/docs/webhooks/refunds/
 *
 * Every fixture sets `synthetic: true`. Identifiers are fabricated.
 * Not live customer data. Not a dashboard webhook secret.
 */

export const RAZORPAY_FIXTURE_EVENT_ID = {
  AUTHORIZED: "evt_synthetic_authorized_1",
  CAPTURED: "evt_synthetic_captured_1",
  FAILED: "evt_synthetic_failed_1",
  REFUND_CREATED: "evt_synthetic_refund_created_1",
  UNSUPPORTED: "evt_synthetic_unsupported_1",
} as const;

export const RAZORPAY_FIXTURE_PAYMENT_ID = "pay_SYNTHETIChookx01";
export const RAZORPAY_FIXTURE_ORDER_ID = "order_SYNTHETIChookx01";
export const RAZORPAY_FIXTURE_REFUND_ID = "rfnd_SYNTHETIChookx01";
export const RAZORPAY_FIXTURE_AMOUNT = 10000;
export const RAZORPAY_FIXTURE_CURRENCY = "INR";
export const RAZORPAY_FIXTURE_CREATED_AT = 1700000000;
export const RAZORPAY_FIXTURE_CAPTURED_AT = 1700000002;
export const RAZORPAY_FIXTURE_FAILED_AT = 1700000003;
export const RAZORPAY_FIXTURE_REFUND_AT = 1700000100;
export const RAZORPAY_FIXTURE_OCCURRED_AT = "2023-11-14T22:13:20.000Z";
export const RAZORPAY_FIXTURE_CAPTURED_OCCURRED_AT = "2023-11-14T22:13:22.000Z";
export const RAZORPAY_FIXTURE_FAILED_OCCURRED_AT = "2023-11-14T22:13:23.000Z";
export const RAZORPAY_FIXTURE_REFUND_OCCURRED_AT = "2023-11-14T22:15:00.000Z";

type PaymentEntityOverride = {
  readonly id?: string;
  readonly amount?: number | string;
  readonly currency?: string;
  readonly status?: string;
  readonly order_id?: string | null;
  readonly created_at?: number;
};

function paymentEntity(override: PaymentEntityOverride = {}) {
  return Object.freeze({
    id: override.id ?? RAZORPAY_FIXTURE_PAYMENT_ID,
    entity: "payment",
    amount: override.amount ?? RAZORPAY_FIXTURE_AMOUNT,
    currency: override.currency ?? RAZORPAY_FIXTURE_CURRENCY,
    status: override.status ?? "authorized",
    order_id: override.order_id === undefined ? RAZORPAY_FIXTURE_ORDER_ID : override.order_id,
    invoice_id: null,
    international: false,
    method: "card",
    amount_refunded: 0,
    refund_status: null,
    captured: override.status === "captured",
    description: null,
    card_id: null,
    bank: null,
    wallet: null,
    vpa: null,
    notes: [],
    fee: null,
    tax: null,
    error_code: null,
    error_description: null,
    created_at: override.created_at ?? 1699999900,
  });
}

function envelope(input: {
  readonly event: string;
  readonly created_at: number;
  readonly payload: Record<string, unknown>;
  readonly contains: readonly string[];
}) {
  return Object.freeze({
    synthetic: true,
    entity: "event",
    account_id: "acc_SYNTHETIChookx01",
    event: input.event,
    contains: Object.freeze([...input.contains]),
    payload: Object.freeze(input.payload),
    created_at: input.created_at,
  });
}

export function razorpayPaymentAuthorizedPayload(
  override: PaymentEntityOverride = {},
) {
  return envelope({
    event: "payment.authorized",
    created_at: RAZORPAY_FIXTURE_CREATED_AT,
    contains: ["payment"],
    payload: {
      payment: {
        entity: paymentEntity({ status: "authorized", ...override }),
      },
    },
  });
}

export function razorpayPaymentCapturedPayload(
  override: PaymentEntityOverride = {},
) {
  return envelope({
    event: "payment.captured",
    created_at: RAZORPAY_FIXTURE_CAPTURED_AT,
    contains: ["payment"],
    payload: {
      payment: {
        entity: paymentEntity({
          status: "captured",
          created_at: 1699999900,
          ...override,
        }),
      },
    },
  });
}

export function razorpayPaymentFailedPayload(
  override: PaymentEntityOverride = {},
) {
  return envelope({
    event: "payment.failed",
    created_at: RAZORPAY_FIXTURE_FAILED_AT,
    contains: ["payment"],
    payload: {
      payment: {
        entity: paymentEntity({ status: "failed", ...override }),
      },
    },
  });
}

export function razorpayRefundCreatedPayload(
  override: PaymentEntityOverride & { readonly refundAmount?: number } = {},
) {
  const payment = paymentEntity({
    status: "captured",
    amount: override.amount ?? 500000,
    ...override,
  });
  return envelope({
    event: "refund.created",
    created_at: RAZORPAY_FIXTURE_REFUND_AT,
    contains: ["refund", "payment"],
    payload: {
      refund: {
        entity: Object.freeze({
          id: RAZORPAY_FIXTURE_REFUND_ID,
          entity: "refund",
          amount: override.refundAmount ?? 50000,
          currency: override.currency ?? RAZORPAY_FIXTURE_CURRENCY,
          payment_id: payment.id,
          notes: Object.freeze({ comment: "SYNTHETIC fixture note" }),
          receipt: null,
          created_at: RAZORPAY_FIXTURE_REFUND_AT,
          batch_id: null,
          status: "processed",
          speed_processed: "normal",
          speed_requested: "optimum",
        }),
      },
      payment: { entity: payment },
    },
  });
}

export function razorpayUnsupportedEventPayload() {
  return envelope({
    event: "order.paid",
    created_at: RAZORPAY_FIXTURE_CREATED_AT,
    contains: ["payment", "order"],
    payload: {
      payment: {
        entity: paymentEntity({ status: "captured" }),
      },
    },
  });
}

export function razorpayMalformedPayload() {
  return Object.freeze({
    synthetic: true,
    entity: "event",
    event: "payment.authorized",
    created_at: RAZORPAY_FIXTURE_CREATED_AT,
  });
}

/** SYNTHETIC: authorized envelope with an empty payment id. */
export function razorpayMissingPaymentIdPayload() {
  return razorpayPaymentAuthorizedPayload({ id: "" });
}
