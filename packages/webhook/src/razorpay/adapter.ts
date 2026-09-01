import {
  externalEventId,
  money,
  paymentId,
  providerId,
  type Instant,
  type Money,
  type PayloadHash,
  type PaymentId,
  type ProviderId,
} from "@hookx/domain";
import type { NormalizeOptions, ProviderAdapter } from "../adapter.js";
import {
  createNormalizedWebhookEvent,
  type NormalizedWebhookEvent,
} from "../event.js";
import type { WebhookEventType } from "../event-type.js";
import { WebhookError } from "../errors.js";
import { hashCanonicalPayload } from "../hash.js";
import {
  createWebhookIdentity,
  type WebhookIdentity,
} from "../identity.js";
import { normalizeIsoCurrency } from "../currency.js";
import { headerValue } from "../signature/headers.js";
import { parseRazorpayAmountMinor } from "./amount.js";
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_PROVIDER_NAME,
} from "./constants.js";
import { mapRazorpayEventType } from "./mapping.js";
import { instantFromUnixSeconds } from "./unix.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new WebhookError("INVALID_PAYLOAD", message);
  }
  return value;
}

function nestedEntity(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const wrapper = asObject(own(payload, "payload"), "Webhook payload body is required");
  const section = asObject(own(wrapper, key), "Webhook entity is required");
  return asObject(own(section, "entity"), "Webhook entity is required");
}

function readId(value: unknown, code: "MISSING_PAYMENT_ID" | "INVALID_PAYLOAD"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WebhookError(code, "Payment ID is required");
  }
  return value;
}

export type RazorpayValidatedPayload = {
  readonly eventName: string;
  readonly externalEventId: string;
  readonly paymentId: string;
  readonly orderId: string | null;
  readonly refundId: string | null;
  readonly occurredAt: Instant;
  readonly amountMinor: bigint;
  readonly currency: string;
};

function optionalOrderId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new WebhookError("INVALID_PAYLOAD", "Order identifier is invalid");
  }
  return value;
}

function optionalRefundId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new WebhookError("INVALID_PAYLOAD", "Refund identifier is invalid");
  }
  return value;
}

/**
 * Razorpay Payments / Refunds webhook adapter.
 *
 * Event names, envelope shape, unix `created_at`, and integer amounts follow
 * current official Razorpay documentation. Identity uses `x-razorpay-event-id`
 * because documented JSON samples have no event `id`.
 */
export class RazorpayProviderAdapter
  implements ProviderAdapter<RazorpayValidatedPayload>
{
  public readonly provider: ProviderId = providerId(RAZORPAY_PROVIDER_NAME);

  public validate(
    payload: unknown,
    options?: NormalizeOptions,
  ): RazorpayValidatedPayload {
    if (!isPlainObject(payload)) {
      throw new WebhookError("INVALID_PAYLOAD", "Webhook payload must be an object");
    }

    const entityKind = own(payload, "entity");
    if (entityKind !== undefined && entityKind !== "event") {
      throw new WebhookError("INVALID_PAYLOAD", "Webhook payload must be an object");
    }

    const eventName = own(payload, "event");
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new WebhookError("INVALID_PAYLOAD", "Webhook event name is required");
    }
    mapRazorpayEventType(eventName);

    const headers = options?.headers;
    const eventId = headerValue(
      headers ?? new Map(),
      RAZORPAY_EVENT_ID_HEADER,
    );
    if (eventId === undefined) {
      throw new WebhookError(
        "MISSING_EXTERNAL_ID",
        "External event ID is required",
      );
    }

    const occurredAt = instantFromUnixSeconds(own(payload, "created_at"));
    const isRefund = eventName === "refund.created";
    const paymentEntity = nestedEntity(payload, "payment");
    const refundEntity = isRefund ? nestedEntity(payload, "refund") : null;

    const paymentRef = readId(
      isRefund ? own(refundEntity!, "payment_id") : own(paymentEntity, "id"),
      "MISSING_PAYMENT_ID",
    );
    const moneyEntity = isRefund ? refundEntity! : paymentEntity;
    const amountMinor = parseRazorpayAmountMinor(own(moneyEntity, "amount"));
    const currency = normalizeIsoCurrency(own(moneyEntity, "currency"));
    const orderId = optionalOrderId(own(paymentEntity, "order_id"));
    const refundId = isRefund
      ? optionalRefundId(own(refundEntity!, "id"))
      : null;

    try {
      externalEventId(eventId);
      paymentId(paymentRef);
      if (orderId !== null) {
        paymentId(orderId);
      }
      if (refundId !== null) {
        paymentId(refundId);
      }
    } catch {
      throw new WebhookError(
        "INVALID_PAYLOAD",
        "Payment or event identifier is invalid",
      );
    }

    return Object.freeze({
      eventName,
      externalEventId: eventId,
      paymentId: paymentRef,
      orderId,
      refundId,
      occurredAt,
      amountMinor,
      currency,
    });
  }

  public identify(payload: RazorpayValidatedPayload): WebhookIdentity {
    return createWebhookIdentity(this.provider, payload.externalEventId);
  }

  public extractPaymentId(payload: RazorpayValidatedPayload): PaymentId {
    return paymentId(payload.paymentId);
  }

  public extractOccurredAt(payload: RazorpayValidatedPayload): Instant {
    return payload.occurredAt;
  }

  public extractMoney(payload: RazorpayValidatedPayload): Money {
    return money(payload.amountMinor, normalizeIsoCurrency(payload.currency));
  }

  public mapEventType(payload: RazorpayValidatedPayload): WebhookEventType {
    return mapRazorpayEventType(payload.eventName);
  }

  public hashPayload(payload: RazorpayValidatedPayload): PayloadHash {
    return hashCanonicalPayload({
      provider: this.provider,
      externalEventId: payload.externalEventId,
      providerEventName: payload.eventName,
      paymentId: payload.paymentId,
      occurredAt: payload.occurredAt,
      amountMinor: payload.amountMinor.toString(),
      currency: payload.currency,
    });
  }

  public normalize(
    payload: unknown,
    options: NormalizeOptions,
  ): NormalizedWebhookEvent {
    const valid = this.validate(payload, options);
    const identity = this.identify(valid);
    const extracted = this.extractMoney(valid);
    return createNormalizedWebhookEvent({
      provider: identity.provider,
      externalEventId: identity.externalEventId,
      paymentId: this.extractPaymentId(valid),
      eventType: this.mapEventType(valid),
      occurredAt: this.extractOccurredAt(valid),
      receivedAt: options.receivedAt,
      amountMinor: extracted.amountMinor,
      currency: extracted.currency,
      payloadHash: this.hashPayload(valid),
    });
  }
}

export const razorpayProviderAdapter = new RazorpayProviderAdapter();
