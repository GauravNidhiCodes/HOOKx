# @hookx/storage

PostgreSQL persistence for normalized HOOKX webhook events.

This package stores events after normalization and before state-machine processing. It does not decide payment state.

```
Incoming webhook
      ↓
    Normalize          (@hookx/webhook)
      ↓
Persist event      (@hookx/storage)
      ↓
Detect duplicate / conflict
      ↓
Ordering / replay  (@hookx/state-machine replayEvents)
      ↓
processEvent       (@hookx/state-machine)
      ↓
New payment state
```

The state machine remains usable without PostgreSQL.

## Schema

Table `webhook_events`:

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `id` | `uuid` PK, `gen_random_uuid()` | Internal surrogate key |
| `provider` | `text` | Provider id |
| `external_event_id` | `text` | Provider event id |
| `payment_id` | `text` | Payment id |
| `event_type` | `text` | Normalized event type |
| `occurred_at` | `timestamptz` | Provider occurrence time |
| `received_at` | `timestamptz` | HOOKX receive time |
| `amount_minor_units` | `bigint` | Integer minor units. Not `numeric`/`float`. |
| `currency` | `char(3)` | ISO 4217 alphabetic code |
| `payload_hash` | `text` | Conflict fingerprint |
| `processing_status` | `text` | `RECEIVED` / `PROCESSING` / `PROCESSED` / `REJECTED` / `CONFLICT` |
| `created_at` | `timestamptz` | Row insert time (`now()`) |

Raw provider payloads are not stored. Signatures and secrets do not belong in this table.

## Uniqueness constraint

```sql
UNIQUE (provider, external_event_id)
```

This is enforced by PostgreSQL. Application-level `if (!exists) insert` is not sufficient under concurrency.

## Payment retrieval index

```sql
CREATE INDEX webhook_events_provider_payment_id_idx
  ON webhook_events (provider, payment_id);
```

`listByPayment(provider, paymentId)` loads every stored event for one provider payment. Deterministic order is applied in `replayEvents`, not by SQL `ORDER BY`. The index exists only to make that lookup efficient.

Out-of-order events are never deleted or overwritten. A `DELAYED` capture stays in `webhook_events` until a later replay can apply it.

## Duplicate and conflict semantics

`WebhookEventRepository.store(event)`:

| Case | Result | Row effect |
| --- | --- | --- |
| New identity | `STORED` | Inserts one row at `RECEIVED` |
| Same identity, same `payloadHash` | `DUPLICATE` | No second row |
| Same identity, different `payloadHash` | `CONFLICT` | Original row unchanged |

A duplicate delivery never creates a second event row. A conflicting payload never overwrites `amount_minor_units`, `payload_hash`, or other event columns.

`markConflict(id)` can set `processing_status` to `CONFLICT` on the existing row. That is a status change, not an event overwrite.

## Transaction boundaries

`store` runs in a single transaction:

1. `INSERT ... ON CONFLICT DO NOTHING RETURNING *`
2. If no row was inserted, `SELECT` the existing identity inside the same transaction
3. Compare `payload_hash` → `DUPLICATE` or `CONFLICT`

Status updates (`markProcessing`, `markProcessed`, `markRejected`, `markConflict`) each run in their own transaction with a status predicate so a lost race cannot apply an illegal transition.

## Repository abstraction

Callers depend on `WebhookEventRepository`, not Drizzle. Open a store with `openWebhookEventStore({ url })`.

`processPaymentEvents(repository, provider, paymentId)` loads those rows and calls the pure `replayEvents` coordinator. It does not insert events, delete events, or rewrite payload columns. Running it twice is a repeated projection over the same log.

## Retry and recovery

A verified, persisted webhook that fails **temporarily** during processing is retained and retried. A permanently invalid webhook is dead-lettered. Failure must not mean event loss. Retry must not mean a second payment transition.

```
Stored event
      ↓
processWebhookAttempt   (same pipeline: load → replayEvents → processEvent)
      ↓
Success → PROCESSED / retry SUCCEEDED
      ↓
Retryable failure → RETRY_SCHEDULED + backoff
      ↓
Non-retryable or max attempts → DEAD_LETTERED
```

Retries never bypass idempotency, state-machine validation, or the stored event identity. There is no separate “fast path.”

### Failure classification

| Class | Examples |
| --- | --- |
| `RETRYABLE` | `TEMPORARY_UNAVAILABLE`, `TEMPORARY_DATABASE_FAILURE`, `TRANSIENT_INTERNAL_ERROR`, unclassified thrown errors |
| `NON_RETRYABLE` | `INVALID_SIGNATURE`, `MALFORMED_PAYLOAD`, `INVALID_PAYLOAD`, `INVALID_NORMALIZED_EVENT`, `UNSUPPORTED_EVENT`, `INVALID_TRANSITION`, `PERMANENT_CONFLICT`, and other validation / domain codes |

Invalid signatures and malformed payloads are rejected **before** persistence, so they never enter the retry table. Classification stores a short `last_error_code` only. Stack traces, secrets, signatures, and payloads are not stored.

### Backoff policy

`calculateRetryDelay(attempt, policy)` is pure: no clock, no jitter, no I/O.

```
delayMs = min(maxDelayMs, baseDelayMs * 2^(attempt-1))
```

`attempt` is the 1-based count of failures so far. Defaults: `maxAttempts=5`, `baseDelayMs=1000`, `maxDelayMs=60000`. After `maxAttempts`, the retry is `DEAD_LETTERED`. The webhook event row remains for investigation.

Worker scheduling uses an injected `now` instant. Tests pass a fixed timestamp. `Date.now()` is not read inside backoff or claim predicates.

### Retry persistence

Table `webhook_retries` (one row per webhook event):

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `id` | `uuid` PK | Internal retry id |
| `webhook_event_id` | `uuid` UNIQUE FK → `webhook_events` | Event identity |
| `attempt_count` | `integer` | Claims so far |
| `status` | `text` | `PENDING` / `PROCESSING` / `SUCCEEDED` / `RETRY_SCHEDULED` / `DEAD_LETTERED` |
| `next_attempt_at` | `timestamptz` | Due time |
| `lease_expires_at` | `timestamptz` | Claim visibility timeout |
| `last_error_code` | `text` | Safe failure code only |
| `last_failed_at` | `timestamptz` | Last failure time |
| `created_at` / `updated_at` | `timestamptz` | Row timestamps |

### Dead-letter persistence

Table `webhook_dead_letters` references the original event and retry row. It does **not** copy the webhook payload.

| Column | Purpose |
| --- | --- |
| `webhook_event_id` | UNIQUE FK → `webhook_events` |
| `retry_id` | FK → `webhook_retries` |
| `failure_code` | Final safe code |
| `attempt_count` | Attempts at dead-letter time |
| `dead_lettered_at` | When it was parked |

The event is never deleted. A future operator action will requeue; this revision has no mutation API for that.

### Worker claiming

`runRetryTick({ retry, events, policy, leaseMs }, now)`:

1. `SELECT` due `PENDING` / `RETRY_SCHEDULED` rows (`next_attempt_at <= now`) and stale `PROCESSING` rows (`lease_expires_at <= now`)
2. `FOR UPDATE SKIP LOCKED` so two workers cannot claim the same row
3. Increment `attempt_count`, set `PROCESSING` + lease
4. Call `processWebhookAttempt` (same pipeline as first ingest)
5. `SUCCEEDED`, `RETRY_SCHEDULED`, or `DEAD_LETTERED`

`processFreshEvent` is the ingest path: `ensurePending` then `beginAttempt` **for that event only**. A duplicate delivery while `RETRY_SCHEDULED` or `PROCESSING` does not start a second attempt.

In-memory locks are not used. Claiming is PostgreSQL transaction semantics.

### Stale-worker recovery

If a worker crashes after claiming, the row stays `PROCESSING` until `lease_expires_at`. Another worker may reclaim it. If the event was already `PROCESSED` before the crash, the next attempt returns `ALREADY_PROCESSED` and the retry becomes `SUCCEEDED`.

### Idempotency

`UNIQUE (provider, external_event_id)` remains the authority for event identity. Initial processing, a retry, a duplicate webhook, and another retry still produce one event row and one `ACCEPTED` created transition per replay of that log.

### Operator inspection

Read-only HTTP (no requeue yet):

- `GET /retries` — active retry rows
- `GET /retries/:webhookEventId`
- `GET /dead-letters`
- `GET /dead-letters/:webhookEventId`

Responses include status, attempt count, safe error codes, and timestamps. They do not include payloads, signatures, secrets, or stack traces.

Run one worker tick:

```bash
pnpm --filter @hookx/api retry:tick
```

Requires `HOOKX_DATABASE_URL`. Optional: `HOOKX_RETRY_*` (see `.env.example`).

### Audit preparation

`RetryLifecycleSink` receives structured transitions (`event`, `attempt`, `previousStatus`, `newStatus`, `reason`, `timestamp`). There is no audit package yet; the default sink is silent.

## Configuration

Credentials come from the environment. Nothing is hardcoded.

```
HOOKX_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx
HOOKX_TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx_test
HOOKX_RETRY_MAX_ATTEMPTS=5
HOOKX_RETRY_BASE_DELAY_MS=1000
HOOKX_RETRY_MAX_DELAY_MS=60000
HOOKX_RETRY_LEASE_MS=30000
```

Do not put passwords in source control. If the server requires a password, include it in the URL locally via `.env` (ignored by git).

## Migrations

From the repository root:

```bash
pnpm --filter @hookx/storage db:migrate
```

Requires `HOOKX_DATABASE_URL`. Migrations live in `packages/storage/drizzle/`.

To regenerate SQL after a schema change:

```bash
pnpm --filter @hookx/storage db:generate
```

## Test database requirements

Integration tests talk to a real PostgreSQL database. They are not mocked.

Prerequisite: PostgreSQL 16+ accepting connections. Homebrew on this machine: `postgresql@17`.

The tests:

1. Read `HOOKX_TEST_DATABASE_URL`, or default to `postgres://$USER@127.0.0.1:5432/hookx_test`
2. Refuse to drop `postgres` / `template0` / `template1`
3. `DROP DATABASE IF EXISTS ... WITH (FORCE)` and `CREATE DATABASE` so the schema is empty
4. Apply Drizzle migrations
5. Run uniqueness, conflict, round-trip, status, concurrent insert, payment listing, out-of-order replay, retry claim, and dead-letter tests

Retry integration tests use a separate database pathname (`hookx_retry_test`) so they do not race `hookx_test`. API ingest e2e uses `hookx_api_test`.

If PostgreSQL is not running, those tests fail with a pointer to this README. They do not skip.

```bash
createdb hookx   # optional local app database
pnpm test
```
