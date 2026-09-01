# @hookx/audit

Provider-independent audit event model for HOOKX.

This package describes **what** can be recorded about financial-processing actions. It does not persist rows, serve HTTP, render UI, or decide payment state.

```
Webhook / retry / validation
            ↓
     Live processing
            ↓
   createAuditEvent()     (this package)
            ↓
   AuditRepository.append (@hookx/storage)
```

Replay through `replayEvents` / `processPaymentEvents` is a projection. It must not append audit history. Live ingest and the retry worker emit audit events; historical reconstruction does not.

This is **not** a cryptographic ledger. Rows are append-only at the application and PostgreSQL trigger layer. They are not hash-chained or signed.

## Event model

`AuditEvent` (immutable, `Object.freeze`):

| Field | Meaning |
| --- | --- |
| `auditEventId` | UUID assigned when the row is appended |
| `eventType` | One of the typed names below |
| `occurredAt` | When the described action/event happened (provider time when that is the subject) |
| `recordedAt` | When HOOKX wrote the audit row (injected clock) |
| `provider` | Provider id, or `null` if unknown |
| `paymentId` | Payment id, or `null` if the payload never normalized |
| `webhookEventId` | Stored webhook row id, or `null` if nothing was persisted |
| `previousState` / `resultingState` | Payment states; both `null` when no payment record exists; equal on a rejected transition |
| `actor` | Who performed the action |
| `reason` | Structured code (`INVALID_SIGNATURE`, `DUPLICATE_EVENT`, …) |
| `correlationId` | Request/operation id from the application boundary |
| `metadata` | Small non-sensitive context |

`auditEventId` is not generated inside the state machine. Persistence assigns it.

## Event types

Only types that the live pipeline emits:

| Type | When |
| --- | --- |
| `WEBHOOK_RECEIVED` | First persist of a verified, normalized event |
| `WEBHOOK_REJECTED` | Signature or validation failure (nothing stored) |
| `WEBHOOK_DUPLICATE` | Same identity and payload hash as an existing row |
| `WEBHOOK_CONFLICT` | Same identity, different payload hash, or a replay material conflict |
| `PAYMENT_STATE_CHANGED` | Live `ACCEPTED` transition, or a rejected transition with unchanged state |
| `WEBHOOK_DELAYED` | Live event parked as out-of-order / awaiting a prerequisite |
| `RETRY_SCHEDULED` | Temporary processing failure; next attempt scheduled |
| `RETRY_ATTEMPTED` | A later claim of a scheduled retry (not the first ingest attempt) |
| `RETRY_SUCCEEDED` | A retry claim finished successfully |
| `RETRY_DEAD_LETTERED` | Permanent failure or max attempts |
| `EXCEPTION_DETECTED` | New exception row for a non-named code |
| `WEBHOOK_CONFLICT_DETECTED` | `CONFLICTING_EVENT` exception inserted |
| `INVALID_TRANSITION_DETECTED` | `INVALID_STATE_TRANSITION` exception inserted |
| `RETRY_EXHAUSTED` | `RETRY_EXHAUSTED` exception inserted |
| `EXCEPTION_STATUS_CHANGED` | Operator lifecycle update (reserved; no HTTP mutation yet) |

## Append-only behavior

`AuditRepository` supports `append`, `listByPayment`, `listByWebhook`, and `listByCorrelationId`.

There is no `updateAuditEvent` or `deleteAuditEvent`. A correction is a **new** audit event. PostgreSQL triggers reject `UPDATE` and `DELETE` on `audit_events`. That is operational immutability, not a tamper-proof log.

## Actor model

| Actor | Use |
| --- | --- |
| `SYSTEM` | Verification, normalization rejection, first-pass processing, ingest-time retry schedule |
| `WEBHOOK_PROVIDER` | Delivery that was received, duplicated, or conflicted |
| `RETRY_WORKER` | Claimed retry attempts |
| `OPERATOR` | Reserved; no human authentication exists yet |

There are no end-user identities.

## Correlation IDs

The HTTP `X-Request-Id` (or a generated request id) is the ingest `correlationId`. It is stored on the first audit rows for that delivery.

The retry worker looks up existing audit rows for the webhook event and reuses that correlation id so:

```
webhook → processing → retry → state transition → audit
```

share one id. Pure domain functions do not mint correlation ids. If no prior audit row exists, the worker uses an id created at the worker boundary.

A later duplicate delivery uses **that request’s** correlation id on `WEBHOOK_DUPLICATE`. Metadata may mention the stored webhook id; it does not rewrite the original trail.

## Timestamp semantics

- `occurredAt` is the time of the subject action. For a provider webhook that is `event.occurredAt`, not HOOKX’s clock.
- `recordedAt` is the injected `now` at append time.
- Provider timestamps are never overwritten.
- `Date.now()` is not read inside the state machine or `createAuditEvent`.

## Transaction consistency

When a live attempt reaches a terminal webhook status (`PROCESSED`, `REJECTED`, `CONFLICT`), PostgreSQL writes that status change and the corresponding audit row(s) in **one transaction**.

Retry bookkeeping (`RETRY_SCHEDULED` / `SUCCEEDED` / `DEAD_LETTERED` on `webhook_retries`) is updated in the retry repository. If that update fails after the webhook+audit commit, stale-lease recovery can still mark the retry succeeded without emitting a second `PAYMENT_STATE_CHANGED`.

The whole API request is not one transaction.

## Security

Metadata is sanitized before persist and before HTTP responses:

- Keys matching secret / signature / password / authorization / credential / payload / token / cookie / rawBody are dropped.
- Nested objects are dropped.
- At most 16 scalar keys; strings longer than 128 characters are dropped.

Do not put raw provider bodies, HMAC secrets, or stack traces on an audit event. Reason codes are `A-Z0-9_` only; anything else becomes `TEMPORARY_PROCESSING_FAILURE`.
