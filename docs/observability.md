# Observability

HOOKX observability describes **real system behavior**. It is a read-model over persisted records plus structured logs emitted at processing boundaries.

**HOOKX does not fabricate operational metrics.**

There is no invented uptime, latency, success rate, payment volume, webhook volume, SLA, or reliability percentage. If a measurement was not observed or persisted, the API omits it rather than filling a placeholder.

## Structured logging

The `@hookx/observability` logger writes one JSON object per line.

Every boundary log can include:

- `timestamp`
- `level` (`DEBUG` | `INFO` | `WARN` | `ERROR`)
- `correlationId`
- `provider`
- `eventId`
- `paymentId`
- `eventType`
- `processingDecision`
- `exceptionCode`
- `lifecycle`

Logs are emitted at ingest and retry boundaries (received, signature, persist, duplicate, conflict, retry, replay, exception). Internal helpers are not traced.

Default process logs use `INFO` and above. `WEBHOOK_NORMALIZED` and `PROCESSING_STARTED` are `DEBUG`.

## Correlation IDs

The HTTP ingest `X-Request-Id` (or a generated request id) is the correlation id for that delivery. The same value is written on:

- structured logs
- audit rows
- exception records
- retry attempts started from that ingest

Retry ticks reuse the first audit correlation id for the webhook. Layers do not mint unrelated ids for the same delivery.

A later operator investigation is a separate HTTP request and may have its own correlation id. The incident timeline still joins it by `exceptionId`.

## Lifecycle events

Observability names map onto existing audit types where those already exist:

| Lifecycle | Persisted source |
| --- | --- |
| `WEBHOOK_RECEIVED` | `WEBHOOK_RECEIVED` (and inferred on duplicate/conflict/reject) |
| `SIGNATURE_VERIFIED` | Inferred: a stored webhook was verified before persist |
| `SIGNATURE_REJECTED` | `WEBHOOK_REJECTED` with a signature reason |
| `WEBHOOK_NORMALIZED` | Inferred after a verified payload is accepted |
| `EVENT_PERSISTED` | Inferred from `WEBHOOK_RECEIVED` |
| `DUPLICATE_DETECTED` | `WEBHOOK_DUPLICATE` |
| `CONFLICT_DETECTED` | `WEBHOOK_CONFLICT` / `WEBHOOK_CONFLICT_DETECTED` |
| `PROCESSING_STARTED` | Inferred after persist |
| `STATE_TRANSITION` | `PAYMENT_STATE_CHANGED` |
| `PROCESSING_FAILED` | Rejected ingest / failed processing |
| `RETRY_SCHEDULED` / `RETRY_ATTEMPTED` / `RETRY_SUCCEEDED` | Matching retry audit |
| `RETRY_EXHAUSTED` | `RETRY_DEAD_LETTERED` |
| `REPLAY_STARTED` / `REPLAY_COMPLETED` | `WEBHOOK_DELAYED` and a later state change for that webhook |
| `EXCEPTION_CREATED` | Exception detection audit |
| `INVESTIGATION_AVAILABLE` | Stored investigation row |

Inferred items reuse the audit row’s `recordedAt`. They are not extra source-of-truth rows.

## Incident timeline

An **incident** is a persisted exception. Successful webhooks are not incidents.

Identifiers:

- `incidentId` = `exceptionId`
- `paymentId`, `eventId` (webhook id), `correlationId` when present

`GET /incidents/:id/timeline` composes audit, webhooks, retry/dead-letter, and investigation records. It does not duplicate those tables.

Ordering uses HOOKX clocks (`recordedAt` / investigation `createdAt`), not provider `occurredAt` alone. Items can still show:

- **EVENT TIME** = provider `occurredAt`
- **RECEIVED TIME** = HOOKX `receivedAt`

so delayed and out-of-order delivery remains visible.

Long timelines are paginated (`limit` default 80, max 200).

## Retry and replay

Retry items expose attempt number, scheduled time (only when the retry row is still `RETRY_SCHEDULED` — historical schedules are not invented), actual attempt time from audit `recordedAt`, result, and failure class. Stack traces are not returned.

Replay is labelled separately from normal processing. `replayId` is the audit event id. `eventsConsidered` is the count of stored webhooks in the incident’s current payment scope.

## Sensitive-data policy

Logs and timeline responses must not contain:

- webhook secrets
- API keys
- signatures
- credentials / `Authorization` headers
- complete raw webhook payloads
- unnecessary personal data

Allowlisted operational fields only. Audit metadata is passed through `sanitizeAuditMetadata` before composition.

## Metrics philosophy

`GET /health` is process liveness: `{ "status": "ok" }`. It is not a dashboard.

`GET /ready` is dependency readiness (`SELECT 1`). It is not mixed into `/health`.

`GET /metrics/summary` returns:

- `persisted` — `COUNT(*)` from PostgreSQL (webhook rows, exceptions, retries, dead letters, audit types that actually exist)
- `runtime` — in-process counters since **this API process** started, labelled as such

Zeros mean “this store / this process observed none”. They are not historical SLAs. Ratios and percentages are not computed.

## Synthetic data handling

Simulator traffic uses provider/payment ids prefixed `SYNTHETIC`. Incidents from that data are labelled **SYNTHETIC**.

Razorpay **fixtures** are also labelled SYNTHETIC unless the process opts a provider into live ingest with `HOOKX_LIVE_PROVIDERS` (comma-separated). HOOKX never prints LIVE or PRODUCTION on an incident.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness (database ping when configured) |
| `GET` | `/metrics/summary` | Real persisted + process counts |
| `GET` | `/incidents` | Exception-backed incident list (filters: provider, exception code, severity, status, `from`/`to`) |
| `GET` | `/incidents/:id` | Incident identifiers |
| `GET` | `/incidents/:id/timeline` | Composed chronology |
