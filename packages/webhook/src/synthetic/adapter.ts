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
import { parseAmountMinorString } from "../money.js";
import { normalizeIsoCurrency } from "../currency.js";
import { normalizeOccurredAt } from "../timestamp.js";
import { mapSyntheticEventType } from "./mapping.js";
import {
  SYNTHETIC_PROVIDER_NAME,
  type SyntheticWebhookPayload,
} from "./payload.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function readRequiredString(
  value: unknown,
  missingCode: "MISSING_EXTERNAL_ID" | "MISSING_PAYMENT_ID" | "INVALID_PAYLOAD",
  message: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WebhookError(missingCode, message);
  }
  return value;
}

export class SyntheticProviderAdapter
  implements ProviderAdapter<SyntheticWebhookPayload>
{
  public readonly provider: ProviderId = providerId(SYNTHETIC_PROVIDER_NAME);

  public validate(payload: unknown): SyntheticWebhookPayload {
    if (!isPlainObject(payload)) {
      throw new WebhookError("INVALID_PAYLOAD", "Webhook payload must be an object");
    }

    if (own(payload, "infrastructure") !== SYNTHETIC_PROVIDER_NAME) {
      throw new WebhookError("UNSUPPORTED_PROVIDER", "Provider is not supported");
    }

    const eventRef = readRequiredString(
      own(payload, "event_ref"),
      "MISSING_EXTERNAL_ID",
      "External event ID is required",
    );
    const kindValue = own(payload, "kind");
    if (typeof kindValue !== "string" || kindValue.length === 0) {
      throw new WebhookError("UNSUPPORTED_EVENT", "Provider event type is not supported");
    }
    mapSyntheticEventType(kindValue);

    const entityValue = own(payload, "entity");
    if (!isPlainObject(entityValue)) {
      throw new WebhookError("INVALID_PAYLOAD", "Payment entity is required");
    }

    const paymentRef = readRequiredString(
      own(entityValue, "payment_ref"),
      "MISSING_PAYMENT_ID",
      "Payment ID is required",
    );

    try {
      externalEventId(eventRef);
      paymentId(paymentRef);
    } catch {
      throw new WebhookError(
        "INVALID_PAYLOAD",
        "Payment or event identifier is invalid",
      );
    }

    const bookedAt = own(entityValue, "booked_at");
    const moneyValue = own(entityValue, "money");
    if (!isPlainObject(moneyValue)) {
      throw new WebhookError("INVALID_PAYLOAD", "Payment amount is required");
    }

    const minorUnits = own(moneyValue, "minor_units");
    const ccy = own(moneyValue, "ccy");
    normalizeOccurredAt(bookedAt);
    normalizeIsoCurrency(ccy);
    parseAmountMinorString(minorUnits);

    if (typeof bookedAt !== "string" || typeof minorUnits !== "string" || typeof ccy !== "string") {
      throw new WebhookError("INVALID_PAYLOAD", "Webhook payload must be an object");
    }

    return Object.freeze({
      infrastructure: SYNTHETIC_PROVIDER_NAME,
      event_ref: eventRef,
      kind: kindValue,
      entity: Object.freeze({
        payment_ref: paymentRef,
        booked_at: bookedAt,
        money: Object.freeze({
          minor_units: minorUnits,
          ccy,
        }),
      }),
    });
  }

  public identify(payload: SyntheticWebhookPayload): WebhookIdentity {
    return createWebhookIdentity(this.provider, payload.event_ref);
  }

  public extractPaymentId(payload: SyntheticWebhookPayload): PaymentId {
    return paymentId(payload.entity.payment_ref);
  }

  public extractOccurredAt(payload: SyntheticWebhookPayload): Instant {
    return normalizeOccurredAt(payload.entity.booked_at);
  }

  public extractMoney(payload: SyntheticWebhookPayload): Money {
    return money(
      parseAmountMinorString(payload.entity.money.minor_units),
      normalizeIsoCurrency(payload.entity.money.ccy),
    );
  }

  public mapEventType(payload: SyntheticWebhookPayload): WebhookEventType {
    return mapSyntheticEventType(payload.kind);
  }

  public hashPayload(payload: SyntheticWebhookPayload): PayloadHash {
    const amount = this.extractMoney(payload);
    return hashCanonicalPayload({
      provider: this.provider,
      externalEventId: payload.event_ref,
      providerEventName: payload.kind,
      paymentId: payload.entity.payment_ref,
      occurredAt: this.extractOccurredAt(payload),
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency,
    });
  }

  public normalize(
    payload: unknown,
    options: NormalizeOptions,
  ): NormalizedWebhookEvent {
    const valid = this.validate(payload);
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

export const syntheticProviderAdapter = new SyntheticProviderAdapter();

export function getProviderAdapter(
  provider: string,
): ProviderAdapter<SyntheticWebhookPayload> {
  if (provider !== SYNTHETIC_PROVIDER_NAME) {
    throw new WebhookError("UNSUPPORTED_PROVIDER", "Provider is not supported");
  }
  return syntheticProviderAdapter;
}
