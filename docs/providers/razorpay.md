# Razorpay webhook adapter

HOOKX can ingest **Razorpay-compatible payment webhooks** through the existing generic pipeline. This is a provider adapter, not a Razorpay product integration.

```
Razorpay-shaped webhook
        ↓
POST /webhooks/razorpay  (raw body)
        ↓
HMAC-SHA256 verification (X-Razorpay-Signature)
        ↓
Razorpay adapter (normalize)
        ↓
NormalizedWebhookEvent
        ↓
HOOKX ingest → persist → deterministic engine → exception / recovery → audit → AI investigation
```

The core engine does not know Razorpay payload fields, SDK objects, signature headers, or Razorpay event naming. It sees `NormalizedWebhookEvent` only.

HOOKX does **not** call Razorpay APIs, create charges, capture or refund through Razorpay, or use Key Id / Key Secret. Setting `RAZORPAY_WEBHOOK_SECRET` does not enable live Razorpay processing. Live ingest labeling is a separate opt-in (`HOOKX_LIVE_PROVIDERS`) and does not send traffic to Razorpay.

**Status (do not collapse these):**

| Label | This repository |
| --- | --- |
| **IMPLEMENTED** | HMAC verify, normalize, `POST /webhooks/razorpay`, Failure Lab / Golden Demo path |
| **TESTED WITH SYNTHETIC FIXTURES** | Yes (`packages/webhook/src/razorpay/`, `apps/api/src/http/razorpay.e2e.test.ts`, Failure Lab `RAZORPAY_SHAPED_DUPLICATE`, Golden Demo) |
| **LIVE-TESTED** | **No.** No Razorpay dashboard account, webhook endpoint, or live/test payment was used. |

Setting `RAZORPAY_WEBHOOK_SECRET` to a local placeholder does not constitute live testing.

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
- Constant-time compare of the hex digest (`timingSafeEqual`)
- External event identity from `x-razorpay-event-id` (documented unique per event; JSON samples have no event `id`)
- Normalization of the events listed below onto the existing `NormalizedWebhookEvent`
- Same store identity as every other provider: `provider + externalEventId`
- Synthetic fixtures marked `synthetic: true`
- Failure Lab scenario `RAZORPAY_SHAPED_DUPLICATE` posts through this adapter (no shortcut)

## NOT IMPLEMENTED

- Razorpay Orders / Invoices / Subscriptions / Settlements / Disputes / Payment Links / Route / Smart Collect
- `order.paid`, payment downtime events, `refund.processed`, `refund.failed`, `refund.speed_changed`
- Checkout payment signature (`order_id|payment_id` with Key Secret) — that is not a webhook
- Razorpay REST APIs, Key Id, Key Secret, refunds API, capture API
- A Razorpay `payment.created` webhook — **current Payments webhook docs do not list one**
- Live dashboard credentials in tests
- Automatic secret rotation / dual-secret verification after a dashboard secret change
- A timestamp inside `X-Razorpay-Signature` (Razorpay does not include one)

## Supported events

| Razorpay `event` | HOOKX type | Notes |
| --- | --- | --- |
| `payment.authorized` | `payment.authorized` | Payment id `payload.payment.entity.id` |
| `payment.captured` | `payment.captured` | Same |
| `payment.failed` | `payment.failed` | Same |
| `refund.created` | `refund.created` | Payment id `payload.refund.entity.payment_id`; amount from the refund entity |

Unsupported Razorpay events that verify successfully return HTTP 400 `UNSUPPORTED_EVENT`. They are not stored as payment events and are not mapped to a successful transition.

There is no Razorpay `payment.created` webhook. HOOKX still requires `payment.created` before authorize / capture / fail in the state table. A Razorpay-only stream is stored. Replay classifies those events as `DELAYED` / `AWAITING_PREREQUISITE` (`processEvent` itself returns `INVALID_TRANSITION` from `null`). The payment projection stays empty. HOOKX does **not** invent a created event.

## Normalization contract

The adapter produces the existing `NormalizedWebhookEvent` (`packages/webhook/src/event.ts`). It does not add a second model.

| Field | Source |
| --- | --- |
| `provider` | `razorpay` |
| `externalEventId` | Header `x-razorpay-event-id` |
| `paymentId` | Payment entity `id`, or refund entity `payment_id` |
| `eventType` | Mapped HOOKX type |
| `occurredAt` | Envelope `created_at` (unix seconds) |
| `receivedAt` | HOOKX ingest clock |
| `amountMinor` | Integer minor units as `bigint` |
| `currency` | ISO 4217 alphabetic, uppercased |
| `payloadHash` | SHA-256 of the canonical identity/money fields |

`synthetic` is a fixture/envelope marker only. It is not a field on `NormalizedWebhookEvent`. Order id and refund id are validated on the adapter and dropped from the normalized event.

## Signature verification

Official procedure:

```
key                = webhook secret (RAZORPAY_WEBHOOK_SECRET)
message            = raw webhook request body bytes
expected_signature = HMAC-SHA256(message, key) as hex
received_signature = X-Razorpay-Signature
```

Do **not** `JSON.parse` then `JSON.stringify` before HMAC. Official docs: “Do Not Parse or Cast the Webhook Request Body.”

The HTTP layer reads `arrayBuffer()`, checks `Content-Type: application/json` (charset allowed) and a 256 KiB body cap, then passes the original bytes to the verifier. JSON parse happens only after `VERIFIED`.

| Header / secret | Result |
| --- | --- |
| Missing `X-Razorpay-Signature` | `MISSING_SIGNATURE` (401) |
| Malformed (not 64 hex chars) | `MALFORMED_SIGNATURE` (400) |
| Secret unset or mismatch | `INVALID_SIGNATURE` (401) — fail closed |
| Valid | `VERIFIED`, then adapter |

Secrets, signature header values, and authorization material are not logged or returned.

If `RAZORPAY_WEBHOOK_SECRET` is unset, `POST /webhooks/razorpay` still exists and fails closed. The API process can start without this variable.

## Identifiers

| Razorpay field | HOOKX field |
| --- | --- |
| Header `x-razorpay-event-id` | `externalEventId` |
| `payload.payment.entity.id` (`pay_…`) | `paymentId` |
| `payload.payment.entity.order_id` (`order_…`) | Not the payment id. Validated on the adapter, dropped from the normalized event |
| `payload.refund.entity.id` (`rfnd_…`) | Not the payment id. Validated on the adapter, dropped from the normalized event |
| `event` | mapped `eventType` |

## Money

Razorpay `amount` is an integer in the smallest currency sub-unit (for INR, paise). HOOKX stores `bigint` minor units plus the ISO 4217 `currency` string.

- JSON numbers are accepted only when they are safe non-negative integers.
- Integer decimal strings (`"10000"`) are accepted. Floats, `1e4`, and negatives are `INVALID_AMOUNT`.
- No `Number` arithmetic is used to convert rupees. Currency exponent tables are not applied; the provider's minor units are stored as given.
- Invalid currency (not a 3-letter alphabetic code) is `INVALID_CURRENCY`.
- Refund amounts are taken from the refund entity. The engine does not subtract refund minor units from the payment projection; a valid `refund.created` after `CAPTURED` moves state to `REFUNDED` and keeps the existing amount.

## Timestamps

| Clock | Source |
| --- | --- |
| `occurredAt` | Event envelope `created_at` (unix seconds) — when Razorpay created the **webhook event** |
| `receivedAt` | HOOKX ingest clock |
| Processed / audited time | Audit `recordedAt` and retry rows — not used as event truth |

Payment entity `created_at` is the payment’s own created time and is **not** used as `occurredAt` (authorized and captured samples share the same payment `created_at`).

Delayed and out-of-order Razorpay-shaped events keep their envelope `occurredAt`. Without `payment.created`, they remain `DELAYED` and do not project payment state.

## Idempotency

Existing `provider + externalEventId` uniqueness. `externalEventId` is the Razorpay event header, not the payment id.

| Second delivery | Result |
| --- | --- |
| Same event id, same material hash | `DUPLICATE` — no second transition |
| Same event id, different material hash | `CONFLICTING_EVENT` / HTTP 409 — original row kept |

## Replay protection

Razorpay’s webhook MAC has **no timestamp**. HOOKX does not invent a replay window for `X-Razorpay-Signature`.

Protection that exists: a redelivered body with the same `x-razorpay-event-id` is a store-level duplicate or conflict after verification.

Limitation: an attacker who can mint a new event id and a valid HMAC (i.e. who has the webhook secret) can create a new stored event. That is ordinary webhook-secret compromise, not a HOOKX bypass. An old signed body replayed with the **same** event id is detected as duplicate identity.

## HTTP responses

Successful receipt returns `{ status: "accepted" | "duplicate", requestId }` without adapter internals.

Invalid signature / missing signature: 401 with a stable code. Malformed signature or payload: 400. Conflict: 409. Oversized body: 413 `PAYLOAD_TOO_LARGE`. Wrong content type: 415 `UNSUPPORTED_MEDIA_TYPE`. Internal failures: 500 `TEMPORARY_PROCESSING_FAILURE` without stack traces.

Provider adapter failures use stable `WebhookError` codes (`UNSUPPORTED_EVENT`, `INVALID_AMOUNT`, `MISSING_PAYMENT_ID`, …). The engine does not parse Razorpay error strings.

## Synthetic fixtures

Fixtures in `@hookx/webhook` (`razorpayPaymentAuthorizedPayload`, …) are labelled `synthetic: true`. Identifiers are fabricated (`pay_SYNTHETIChookx01`, `evt_synthetic_…`). They are not live customer data, dashboard webhook secrets, or real signatures.

Coverage: authorized, captured, failed, refund.created, unsupported (`order.paid`), malformed envelope, missing payment id, duplicate delivery, conflicting amount, invalid signature (HTTP tests).

Sign with `signRazorpayWebhook` and send:

```
POST /webhooks/razorpay
Content-Type: application/json
X-Razorpay-Signature: <hex HMAC of the raw body>
x-razorpay-event-id: <unique event id>
```

## Failure Lab

Scenario `RAZORPAY_SHAPED_DUPLICATE` signs a synthetic `payment.authorized` envelope and posts it twice to `POST /webhooks/razorpay`. Payment ids remain `SYNTHETIC:pay:lab-{runId}` so reset still purges them. PROVIDER is `razorpay`. DATA SOURCE is SYNTHETIC. Requires `RAZORPAY_WEBHOOK_SECRET`.

Scenario `GOLDEN_DEMO` uses the same adapter path with lab-only `FAIL_ONCE` injection (lab payment prefix only; live-shaped `pay_*` ids are not injected). Operator view: `/demo`. See `docs/golden-demo.md`.

## AI investigation

Investigations receive normalized webhook views (ids, types, amounts as strings, statuses), exceptions, audit, and timeline. Raw Razorpay envelopes, signature headers, payload hashes, and webhook secrets are not sent to the model.

## Configuration

`.env.example` placeholders only (empty values):

```
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
HOOKX_LIVE_PROVIDERS=
```

`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are **not used**. They exist so operators do not paste Key Secret into the webhook-secret slot by accident. Webhook ingest reads `RAZORPAY_WEBHOOK_SECRET` only.

`HOOKX_LIVE_PROVIDERS` only changes SYNTHETIC vs undeclared origin **labels**. It does not call Razorpay and does not switch the adapter into a live API client. Presence of any of these variables is not a production go-live switch.

## Security

Never log or return:

- `RAZORPAY_WEBHOOK_SECRET`, Key Id, Key Secret
- the signature header value
- raw bodies or customer email/contact/notes

Safe observation fields: provider, event id, payment id, event type, correlation id, processing decision.

## Limitations

- Tested with synthetic fixtures only, not a Razorpay account.
- No `payment.created` from Razorpay; Razorpay-only streams do not project payment state.
- No HMAC timestamp / skew window.
- Refund processing does not subtract amounts; it follows the existing state table.
- Body size cap is 256 KiB at the ingest route, not a full API gateway.
