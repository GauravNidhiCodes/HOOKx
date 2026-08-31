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
processEvent       (@hookx/state-machine)
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

## Configuration

Credentials come from the environment. Nothing is hardcoded.

```
HOOKX_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx
HOOKX_TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx_test
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
5. Run uniqueness, conflict, round-trip, status, and concurrent insert tests

If PostgreSQL is not running, those tests fail with a pointer to this README. They do not skip.

```bash
createdb hookx   # optional local app database
pnpm test
```
