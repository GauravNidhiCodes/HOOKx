# @hookx/api

HTTP API for HOOKX webhook ingest, retry inspection, and read-only payment/audit queries.

This service is the request boundary. It does not own payment transition rules, provider parsing, schema SQL, or retry backoff.

Live Razorpay (or any live PSP) integration is not implemented. The only ingest adapter is the synthetic provider (`SYNTHETIC`).

## `POST /webhooks/:provider`

Primary ingest route. `:provider` is the provider identifier (`SYNTHETIC` for local and test deliveries).

### Request flow

No layer is skipped:

```
HTTP REQUEST
     ↓
Raw body capture          (ArrayBuffer; JSON is not parsed yet)
     ↓
Signature verification    (HMAC over the original bytes)
     ↓
Provider adapter
     ↓
Payload validation
     ↓
Normalization             (raw payload → WebhookEvent)
     ↓
Idempotent event persist  (NEW / DUPLICATE / CONFLICT)
     ↓
Processing decision
     ↓
Deterministic replay      (@hookx/state-machine)
     ↓
Durable payment + audit   (one PostgreSQL transaction)
     ↓
HTTP RESPONSE
```

The HTTP layer only:

1. Captures the raw request body
2. Reads the provider identifier
3. Forwards signature headers
4. Creates a correlation / request id (`X-Request-Id` or a generated UUID)
5. Calls `processIncomingWebhook`

Correlation ids are generated at this boundary, never inside the state machine.

### Signature requirement

Verification runs on the original raw body **before** `JSON.parse`.

The synthetic verifier expects `X-Hookx-Synthetic-Signature` (`t=<unix>,v1=<hex>`). The secret comes from `HOOKX_SYNTHETIC_WEBHOOK_SECRET`. The expected signature and secret are never returned.

| Condition | HTTP | Persist event | Mutate payment |
| --- | --- | --- | --- |
| Missing / invalid / expired signature | 401 | No | No |
| Malformed signature header | 400 | No | No |
| Unknown provider | 404 | No | No |

### Normalization

After verification, the provider adapter validates and normalizes the payload. Failure (malformed JSON, unsupported event, invalid money/timestamp) is HTTP 400. Nothing is stored as a valid webhook event. Payment state is unchanged.

### Idempotency

Identity is `provider + external_event_id`. PostgreSQL `UNIQUE (provider, external_event_id)` is the authority.

| Store result | Meaning | Processing | HTTP |
| --- | --- | --- | --- |
| NEW (`STORED`) | First accepted identity | Replay + persist payment | 200 `accepted`, or 500 if processing is temporarily retryable |
| DUPLICATE | Same identity, same payload hash | No second payment transition | 200 `duplicate` |
| CONFLICT | Same identity, different payload hash | Original row kept; no overwrite; no payment mutation | 409 `conflict` |

### Duplicate behavior

A second identical delivery returns HTTP 200 `{ "status": "duplicate", "requestId" }`. The existing event row is unchanged. Replay is not applied again. A `WEBHOOK_DUPLICATE` audit row is appended. If the first delivery is still retrying, the duplicate does not start a second attempt.

### Conflict behavior

A second delivery with the same event id and a different payload hash returns HTTP 409. The original stored event (amount, hash, type) is not overwritten. Payment state stays as the first accepted processing left it. A `WEBHOOK_CONFLICT` audit row is recorded.

### Response semantics

Response bodies contain only `status`, `requestId`, and an optional `code`. They never include stack traces, SQL, secrets, raw payloads, or filesystem paths.

| Outcome | HTTP | Body |
| --- | --- | --- |
| New webhook processed | 200 | `{ "status": "accepted", "requestId" }` |
| Duplicate valid webhook | 200 | `{ "status": "duplicate", "requestId" }` |
| Invalid / missing / expired signature | 401 | `{ "status": "unauthorized", "requestId", "code" }` |
| Malformed signature or payload | 400 | `{ "status": "bad_request", "requestId", "code" }` |
| Unknown provider | 404 | `{ "status": "not_found", "requestId", "code": "UNSUPPORTED_PROVIDER" }` |
| Conflicting event identity | 409 | `{ "status": "conflict", "requestId", "code": "CONFLICT" }` |
| Retryable processing failure after persist | 500 | `{ "status": "error", "requestId", "code": "TEMPORARY_PROCESSING_FAILURE" }` |
| Permanent processing failure after persist | 200 | `{ "status": "accepted", "requestId" }` (event retained, dead-lettered) |

A 500 after persist means the webhook row is durable and a retry is scheduled. A later provider retry is a DUPLICATE and must not process twice.

### Security model

- Untrusted bytes are verified before parse.
- Provider adapters are isolated; `SYNTHETIC` cannot ingest another provider name.
- Secrets, signatures, and raw payloads are not written to webhook, payment, retry, or audit rows.
- Audit metadata is sanitized on read.
- Correlation id is an HTTP/application concern.

## Other routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Service descriptor |
| GET | `/payments/:paymentId` | Durable payment projection |
| GET | `/payments/:paymentId/audit` | Append-only audit for a payment |
| GET | `/webhooks/:webhookEventId/audit` | Audit for one stored webhook |
| GET | `/audit?correlationId=` | Audit by correlation id |
| GET | `/retries` / `/retries/:webhookEventId` | Active retry inspection |
| GET | `/dead-letters` / `/dead-letters/:webhookEventId` | Dead-letter inspection |
| GET | `/exceptions` | Read-only exceptions (`status`, `severity`, `exceptionCode`, `provider` filters) |
| GET | `/exceptions/:id` | One exception |
| GET | `/payments/:paymentId/exceptions` | Exceptions for a payment |

There is no retry mutation API yet. There is no exception acknowledgement/resolution API yet.

## Synthetic simulator

`pnpm simulate <scenario>` generates signed synthetic webhooks and posts them to the real `POST /webhooks/SYNTHETIC` handler. It is not a live payment-provider integration.

See `docs/simulation.md`.

All simulator events are synthetic and do not represent real payment transactions.

## Run

Requires `HOOKX_DATABASE_URL` and `HOOKX_SYNTHETIC_WEBHOOK_SECRET`. See the repository `.env.example`.
