# @hookx/webhook

Provider-agnostic webhook normalization and signature verification for HOOKX.

External payment-provider payloads are untrusted and provider-specific. Signature verification is the security boundary: nothing is treated as a financial event until authenticity is proven against the **original raw request body**.

```
HTTP Request
      ↓
Raw Request Body
      ↓
Signature Verification     (this package: SignatureVerifier)
      ↓
Provider Adapter
      ↓
Validation
      ↓
Normalized WebhookEvent
      ↓
Idempotent storage / state machine (other packages)
```

The synthetic provider is test infrastructure and does not represent live payment-provider integration.

## Signature verification boundary

`SignatureVerifier` is provider-agnostic:

```ts
verify({ rawBody, headers, now }): SignatureVerificationResult
```

It checks authenticity of the raw bytes plus provider-specific signature material. It does **not**:

- parse or re-serialize JSON
- read HTTP routing
- load secrets from the environment (callers inject them)
- read `Date.now()` (callers inject `now`)
- persist events or mutate payment state

`@hookx/domain` knows nothing about headers, HMAC, or secrets.

Verification outcomes:

| Status | Meaning |
| --- | --- |
| `VERIFIED` | Authenticity and (when used) timestamp window succeeded |
| `INVALID_SIGNATURE` | Well-formed signature that does not match |
| `MISSING_SIGNATURE` | Required signature header absent |
| `MALFORMED_SIGNATURE` | Header present but not a valid encoding |
| `EXPIRED_SIGNATURE` | MAC valid but timestamp outside the replay window |

Only `VERIFIED` may continue into the adapter / normalization. Expected failures are result objects, not thrown generic errors.

## Raw-body requirement

HMAC is computed over the exact request bytes.

Do **not**:

```
JSON.parse(body) → JSON.stringify(parsed) → HMAC
```

Serialization can change whitespace, key order, and Unicode escapes, which invalidates (or worse, desynchronizes) the signed payload.

The HTTP layer must keep `ArrayBuffer` / `Uint8Array` / the original text until `verify` returns `VERIFIED`. JSON parse happens after that.

## Provider adapter model

Signature algorithms belong to provider adapters. The pipeline depends on `SignatureVerifier`, not a single HMAC format.

```
WebhookVerifier (interface)
      ↑
SyntheticVerifier     (HMAC-SHA256 + timestamp, local/test only)
RazorpayVerifier      (HMAC-SHA256 of raw body, `X-Razorpay-Signature`)
```

`createSignatureVerifierRegistry` registers `SYNTHETIC` and `razorpay`. Any other provider name returns `null`. Those requests must not be ingested.

`ProviderAdapter<TPayload>` maps a verified envelope to the normalized event. Razorpay-specific parsing lives in `src/razorpay/`.

## Synthetic signing scheme

**For local development and tests only.** Not compatible with live payment-provider webhooks.

Header: `X-Hookx-Signature`

```
t=<unixSeconds>,v1=<hex(hmac-sha256)>
```

Signed material:

```
HMAC-SHA256(secret, utf8(timestampSeconds + ".") || rawBodyBytes)
```

Verification:

1. Parse the header (`MISSING` / `MALFORMED` if it is absent or not `t=<digits>,v1=<64 hex chars>`).
2. Recompute the digest over the original raw body and compare with `crypto.timingSafeEqual` (`signaturesEqual`). Ordinary string `===` is not used for digests.
3. If the MAC matches, require `|nowSeconds - t| <= toleranceSeconds`. `now` is an injected UTC instant. `Date.now()` is not read inside `verify`.

Default tolerance is 300 seconds (`HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS`).

`signSyntheticWebhook` exists so tests and local tools can mint a header. It is not a production PSP client.

## Secret handling

Secrets are supplied by the application from environment configuration. This package never hardcodes a webhook secret, never logs one, and never puts one on `SignatureVerificationResult`.

API / process environment (placeholders only — see `.env.example`):

```
HOOKX_SYNTHETIC_WEBHOOK_SECRET=dev-only-not-a-real-secret
HOOKX_SYNTHETIC_WEBHOOK_TOLERANCE_SECONDS=300
RAZORPAY_WEBHOOK_SECRET=
```

Do not commit real secrets, print them, return them in HTTP bodies, or store them on webhook event rows.

## Replay / timestamp behavior

The synthetic scheme includes a unix timestamp in the signature header so a replay window can be enforced.

- Authenticity is checked first. An invalid MAC is `INVALID_SIGNATURE` even if the timestamp is also stale (no extra oracle).
- The window uses the injected `now` instant converted to unix seconds from the timestamp string, not the system clock.
- Live Stripe replay rules are not implemented.
- Razorpay does not include a timestamp in `X-Razorpay-Signature`; HOOKX does not invent a replay window for that header.

## Security assumptions

- Every provider payload is untrusted until `VERIFIED`.
- An attacker who knows an existing `externalEventId` cannot inject a new financial event without a valid signature for that raw body.
- Identity/deduplication happens after verification.
- This package does not execute code from payloads.
- Error / result messages do not include secrets, signature values, or the raw payload.
- Do not log webhook secrets, signature secrets, authorization credentials, or complete sensitive raw payloads.
- The synthetic verifier is **not** a live payment-provider integration.

## Retry classification at this boundary

Signature and normalization failures are **non-retryable** and are not persisted:

| Failure | Retry? |
| --- | --- |
| Invalid / missing / expired / malformed signature | No. Never stored. |
| Malformed JSON or invalid normalized payload | No. Never stored. |
| Unsupported provider or event type | No. Never stored. |
| Temporary failure **after** a valid event is stored | Yes. `@hookx/storage` schedules PostgreSQL-backed retries. |
| Permanent domain conflict / illegal transition after persist | Dead-lettered. Not retried indefinitely. |

`@hookx/webhook` does not implement the retry worker. It only refuses to treat unverified or invalid input as a financial event.

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
| `INVALID_AMOUNT` | Amount is not a minor-unit decimal string (synthetic) or a non-negative integer (Razorpay) |
| `INVALID_CURRENCY` | Not a 3-letter alphabetic code |
| `INVALID_TIMESTAMP` | Not a UTC instant (`Z` or `+00:00`), or not unix seconds (Razorpay) |

## Event identity

Identity is `provider + externalEventId` via `createWebhookIdentity` / `webhookIdentityKey`. It is never random and never derived from `payloadHash`.

## Payload hashing

`payloadHash` is SHA-256 (Node `crypto`) of a canonical document of material fields: provider, external id, provider event name, payment id, normalized `occurredAt`, amount minor-unit decimal string, and currency.

Same material → same hash. Same external id with a changed amount → different hash. `receivedAt` is not hashed. The hash is for conflict detection, not identity. Signatures and other secrets are not included in the canonical document.

## Money

Provider amounts enter as decimal strings (`"10000"` → `10000n`) using `BigInt`. `Number`, `parseFloat`, and floating-point arithmetic are not used for amounts. Currency is trimmed and uppercased (`"inr"` → `"INR"`), then rejected if it is not three letters.

## Synthetic provider envelope

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

## Razorpay provider

See `docs/razorpay.md`. Adapter `razorpay`. Event id is the `x-razorpay-event-id` header. Amounts are JSON integers in minor units. `occurredAt` is envelope `created_at` unix seconds.
