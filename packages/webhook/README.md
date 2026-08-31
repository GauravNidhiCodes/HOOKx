# @hookx/webhook

Provider-agnostic webhook normalization for HOOKX.

External payment-provider payloads are untrusted and provider-specific. This package converts them into one internal event, then stops. It does not decide payment state.

```
Provider payload
      ↓
Provider adapter
      ↓
Validation
      ↓
Normalized WebhookEvent
      ↓
State machine (separate package)
```

The synthetic provider is test infrastructure and does not represent live payment-provider integration.

## Adapter architecture

`ProviderAdapter<TPayload>` is generic over a provider envelope. It is not coupled to Razorpay, Stripe, or any live PSP.

An adapter must:

- `validate` the unknown payload or throw a `WebhookError`
- `identify` the webhook as `provider + externalEventId`
- `mapEventType` onto internal types (`payment.created`, …)
- extract payment id, occurrence timestamp, and money
- `hashPayload` for conflict detection
- `normalize` into a `NormalizedWebhookEvent`

`receivedAt` is supplied by the application (`NormalizeOptions`). This package never uses the system clock as `occurredAt`.

A later Stripe or Adyen adapter should implement the same interface. `getProviderAdapter` currently only serves `SYNTHETIC`; any other name is `UNSUPPORTED_PROVIDER`.

## Normalization

`createNormalizedWebhookEvent` is the only constructor for the internal event. It copies these fields and nothing else:

- `provider`
- `externalEventId`
- `paymentId`
- `eventType`
- `occurredAt`
- `receivedAt`
- `amountMinor` (`bigint`)
- `currency` (ISO 4217 alphabetic, uppercase)
- `payloadHash`

Provider envelopes, signatures, notes, and extra keys are dropped at the adapter boundary.

## Validation

Unknown input is treated as untrusted. Validation is explicit (Zod is not a workspace dependency). Invalid financial events are not partially normalized.

Typed errors:

| Code | When |
| --- | --- |
| `INVALID_PAYLOAD` | Not an object, missing entity, invalid identifiers |
| `UNSUPPORTED_PROVIDER` | Unknown adapter / missing synthetic marker |
| `UNSUPPORTED_EVENT` | Provider event name is not mapped |
| `MISSING_EXTERNAL_ID` | Empty or absent event id |
| `MISSING_PAYMENT_ID` | Empty or absent payment id |
| `INVALID_AMOUNT` | Amount is not a minor-unit decimal string |
| `INVALID_CURRENCY` | Not a 3-letter alphabetic code |
| `INVALID_TIMESTAMP` | Not a UTC instant (`Z` or `+00:00`) |

## Event identity

Identity is `provider + externalEventId` via `createWebhookIdentity` / `webhookIdentityKey`. It is never random and never derived from `payloadHash`.

## Payload hashing

`payloadHash` is SHA-256 (Node `crypto`) of a canonical document of material fields: provider, external id, provider event name, payment id, normalized `occurredAt`, amount minor-unit decimal string, and currency.

Same material → same hash. Same external id with a changed amount → different hash. `receivedAt` is not hashed. The hash is for conflict detection, not identity. Signatures and other secrets are not included in the canonical document.

## Money

Provider amounts enter as decimal strings (`"10000"` → `10000n`) using `BigInt`. `Number`, `parseFloat`, and floating-point arithmetic are not used for amounts. Currency is trimmed and uppercased (`"inr"` → `"INR"`), then rejected if it is not three letters.

## Synthetic provider

`SyntheticProviderAdapter` understands a deliberately provider-shaped envelope (`event_ref`, `kind`, `entity.payment_ref`, `booked_at`, `money.minor_units`, `ccy`) marked `infrastructure: "SYNTHETIC"`.

Event mapping:

| Provider `kind` | Internal type |
| --- | --- |
| `syn.payment.opened` | `payment.created` |
| `syn.payment.hold` | `payment.authorized` |
| `syn.payment.settled` | `payment.captured` |
| `syn.payment.declined` | `payment.failed` |
| `syn.payment.return` | `refund.created` |

Unknown kinds are rejected.

## Security assumptions

- Every provider payload is untrusted.
- This package does not execute code from payloads.
- Internal payment state is not accepted from the client; only extracted identifiers and amounts after validation.
- Arbitrary event types are rejected.
- Error messages are safe to expose later over HTTP: they do not include secrets or the raw payload.
- Do not log full payloads in callers.

The synthetic provider is test infrastructure and does not represent live payment-provider integration.
