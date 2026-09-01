import type { WebhookEventType } from "../event-type.js";
import { WebhookError } from "../errors.js";

/**
 * Razorpay event names that map onto an existing HOOKX webhook type
 * without inventing lifecycle meaning.
 *
 * Official payment events: https://razorpay.com/docs/webhooks/payments/
 * Official refund events: https://razorpay.com/docs/webhooks/refunds/
 *
 * There is no Razorpay `payment.created` webhook in current payments docs.
 * `refund.processed` / `refund.failed` / `refund.speed_changed` have no
 * distinct HOOKX event type. `order.paid` duplicates capture semantics and
 * is left unmapped.
 */
export const RAZORPAY_EVENT_TYPE_MAP = Object.freeze({
  "payment.authorized": "payment.authorized",
  "payment.captured": "payment.captured",
  "payment.failed": "payment.failed",
  "refund.created": "refund.created",
} as const satisfies Record<string, WebhookEventType>);

export type RazorpaySupportedEventName = keyof typeof RAZORPAY_EVENT_TYPE_MAP;

export function isRazorpaySupportedEventName(
  value: string,
): value is RazorpaySupportedEventName {
  return Object.hasOwn(RAZORPAY_EVENT_TYPE_MAP, value);
}

export function mapRazorpayEventType(eventName: string): WebhookEventType {
  if (!isRazorpaySupportedEventName(eventName)) {
    throw new WebhookError(
      "UNSUPPORTED_EVENT",
      "Provider event type is not supported",
    );
  }
  return RAZORPAY_EVENT_TYPE_MAP[eventName];
}
