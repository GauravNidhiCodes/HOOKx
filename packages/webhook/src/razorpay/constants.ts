/**
 * Razorpay webhook constants from current official documentation.
 *
 * Signature header and HMAC procedure:
 * https://razorpay.com/docs/webhooks/validate-test/
 *
 * Duplicate-event header:
 * https://razorpay.com/docs/webhooks/validate-test/ (Idempotency)
 * https://razorpay.com/docs/webhooks/best-practices/
 *
 * Payment events:
 * https://razorpay.com/docs/webhooks/payments/
 *
 * Refund events:
 * https://razorpay.com/docs/webhooks/refunds/
 *
 * Amount representation:
 * https://razorpay.com/docs/api/payments/entity/
 */

export const RAZORPAY_PROVIDER_NAME = "razorpay" as const;

/**
 * Documented header name: `X-Razorpay-Signature`.
 * HTTP lookups are case-insensitive; this package stores maps in lowercase.
 */
export const RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature";

/**
 * Documented header name: `x-razorpay-event-id`.
 * Official docs: unique per webhook event; use for idempotency.
 * Sample JSON envelopes do not include an event `id` field.
 */
export const RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id";
