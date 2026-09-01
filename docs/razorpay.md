# Razorpay webhook adapter

HOOKX can ingest **Razorpay Payments webhooks** through the existing generic pipeline:

```
POST /webhooks/razorpay
  → raw body
  → X-Razorpay-Signature verification
  → Razorpay adapter
  → normalized WebhookEvent
  → idempotent persist
  → deterministic replay
```

This is **not** a complete Razorpay integration. HOOKX does not call Razorpay APIs, create charges, or use Key Id / Key Secret.

## Official documentation consulted

| Topic | Source |
| --- | --- |
| Signature header and HMAC | [Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/) |
| Idempotency header | Same page, plus [Best Practices](https://razorpay.com/docs/webhooks/best-practices/) |
| Payment events and sample envelopes | [Payments Webhook Events](https://razorpay.com/docs/webhooks/payments/) |
| Refund events and sample envelopes | [Refunds Webhook Events](https://razorpay.com/docs/webhooks/refunds/) |
| Amount as integer minor units; `created_at` unix seconds | [Payments Entity](https://razorpay.com/docs/api/payments/entity/) |
| Hex HMAC encoding | Official [razorpay-node](https://github.com/razorpay/razorpay-node) `validateWebhookSignature` (`digest('hex')`) |

Do not use blog posts as the contract. If Razorpay changes these pages, change the adapter to match.

## IMPLEMENTED

- `POST /webhooks/razorpay` on the existing ingest route
- HMAC-SHA256 over the **raw** request body; header `X-Razorpay-Signature`
- Secret from `RAZORPAY_WEBHOOK_SECRET` only (optional at process start)
- Constant-time compare of the hex digest
- External event identity from `x-razorpay-event-id` (documented unique per event; JSON samples have no event `id`)
- Normalization of the events listed below
- Same store identity as every other provider: `provider + externalEventId`
- Synthetic fixtures marked `synthetic: true`

## NOT IMPLEMENTED

- Razorpay Orders / Invoices / Subscriptions / Settlements / Disputes / Payment Links / Route / Smart Collect
- `order.paid`, payment downtime events, `refund.processed`, `refund.failed`, `refund.speed_changed`
- Checkout payment signature (`order_id|payment_id` with Key Secret) — that is not a webhook
- Razorpay REST APIs, Key Id, Key Secret, refunds API, capture API
- A Razorpay `payment.created` webhook — **current Payments webhook docs do not list one**
- Live dashboard credentials in tests
- Automatic secret rotation / dual-secret verification after a dashboard secret change

## Supported events

| Razorpay `event` | HOOKX type | Notes |
| --- | --- | --- |
| `payment.authorized` | `payment.authorized` | Payment id `payload.payment.entity.id` |
| `payment.captured` | `payment.captured` | Same |
| `payment.failed` | `payment.failed` | Same |
| `refund.created` | `refund.created` | Payment id `payload.refund.entity.payment_id`; amount from the refund entity |

HOOKX still requires `payment.created` before authorize/capture/fail in the state machine. Razorpay does not send `payment.created`. A Razorpay-only stream is stored and audited, then **DELAYED** until a `payment.created` exists. That gap is not filled by inventing a created event.

Out-of-order `payment.authorized` / `payment.captured` is documented by Razorpay. HOOKX already replays by `occurredAt`. Without `payment.created`, neither event can settle. Use the synthetic simulator for a full created → authorized → captured out-of-order demonstration.

## Signature verification

Official procedure:

```
key                = webhook secret (RAZORPAY_WEBHOOK_SECRET)
message            = raw webhook request body
expected_signature = HMAC-SHA256(message, key) as hex
received_signature = X-Razorpay-Signature
```

Do **not** `JSON.parse` then `JSON.stringify` before HMAC. Official docs: “Do Not Parse or Cast the Webhook Request Body.”

Invalid / missing signatures never reach the adapter, store, or state machine.

If `RAZORPAY_WEBHOOK_SECRET` is unset, `POST /webhooks/razorpay` still exists and fails closed (`INVALID_SIGNATURE` when a header is present). The API process can start without this variable.

## Identifiers

| Razorpay field | HOOKX field |
| --- | --- |
| Header `x-razorpay-event-id` | `externalEventId` |
| `payload.payment.entity.id` (`pay_…`) | `paymentId` |
| `payload.payment.entity.order_id` (`order_…`) | Not the payment id. Validated on the adapter, dropped from the normalized event |
| `payload.refund.entity.id` (`rfnd_…`) | Not the payment id. Validated on the adapter, dropped from the normalized event |
| `event` | mapped `eventType` |

## Money

Razorpay `amount` is an integer in the smallest currency sub-unit (for INR, paise). HOOKX stores `bigint` minor units plus the ISO 4217 `currency` string. JSON numbers are accepted only when they are safe integers. No `Number` arithmetic is used to convert rupees.

## Timestamps

| Clock | Source |
| --- | --- |
| `occurredAt` | Event envelope `created_at` (unix seconds) — when Razorpay created the **webhook event** |
| `receivedAt` | HOOKX ingest clock |

Payment entity `created_at` is the payment’s own created time and is **not** used as `occurredAt` (authorized and captured samples share the same payment `created_at`).

## Idempotency

Existing `provider + externalEventId` uniqueness. `externalEventId` is the Razorpay event header, not the payment id.

| Second delivery | Result |
| --- | --- |
| Same event id, same material hash | `DUPLICATE` — no second transition |
| Same event id, different material hash | `CONFLICTING_EVENT` / HTTP 409 — original row kept |

## Unsupported events

Verified but unmapped events (`order.paid`, downtime, `refund.processed`, …) return HTTP 400 `UNSUPPORTED_EVENT`. Nothing is stored as a payment event. Payment state is unchanged.

## Security

Never log or return:

- `RAZORPAY_WEBHOOK_SECRET`
- API keys
- the signature header value
- raw bodies or customer email/contact/notes

Safe observation fields: provider, event id, payment id, event type, correlation id, processing decision.

`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are **not** used and are not in `.env.example`.

## Environment

```
RAZORPAY_WEBHOOK_SECRET=
```

Leave empty unless you are actually posting to `/webhooks/razorpay`.

## Local testing

Fixtures in `@hookx/webhook` (`razorpayPaymentAuthorizedPayload`, …) are synthetic. Sign with `signRazorpayWebhook` and send:

```
POST /webhooks/razorpay
Content-Type: application/json
X-Razorpay-Signature: <hex HMAC of the raw body>
x-razorpay-event-id: <unique event id>
```

Do not point this at a live Razorpay account for tests. Do not create real payments.
