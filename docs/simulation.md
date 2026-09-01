# Synthetic webhook simulator

All simulator events are synthetic and do not represent real payment transactions.

HOOKX includes a local scenario runner for development, tests, and demonstrations. It generates signed synthetic webhooks and posts them through the **same** HTTP ingest pipeline as production (`POST /webhooks/SYNTHETIC`). There is no demo shortcut around signature verification, persistence, replay, retry, or audit.

The simulator is not a payment simulator. It never calls Razorpay, Stripe, or any external API. No real money moves.

## Commands

From the repository root (PostgreSQL required):

```bash
pnpm simulate --list
pnpm simulate normal
pnpm simulate duplicate
pnpm simulate out-of-order
pnpm simulate conflict
pnpm simulate retry
pnpm simulate dead-letter
pnpm simulate multi
```

Each run recreates a dedicated `hookx_simulate` database so the same logical event sequence is reproducible. Identifiers are deterministic (`SYNTHETIC:pay:sim-normal`, `SYNTHETIC:evt:sim-normal-created`, …). Random IDs are not used.

Optional: `HOOKX_SIMULATE_DATABASE_URL` overrides the simulate database URL.

## Scenarios

| Command | Scenario | What it demonstrates |
| --- | --- | --- |
| `normal` | `NORMAL_FLOW` | created → authorized → captured |
| `duplicate` | `DUPLICATE_DELIVERY` | identical redelivery: one stored event, one transition |
| `out-of-order` | `OUT_OF_ORDER` | created → captured → authorized; capture delayed, replay to CAPTURED |
| `conflict` | `CONFLICT` | same event ID, different amount; original kept |
| `retry` | `RETRY_FAILURE` | first processing attempt fails temporarily, second succeeds |
| `dead-letter` | `PERMANENT_FAILURE` | every attempt fails until max attempts, then dead-letter |
| `multi` | `MULTI_PAYMENT` | two payments, interleaved events, isolation |

Expected outcomes are declared on the scenario definition. Tests do not derive those expectations from the state machine under test.

## Expected behavior

**NORMAL_FLOW** — three accepted deliveries. Durable payment `CAPTURED`. Three `PAYMENT_STATE_CHANGED` audit rows.

**DUPLICATE_DELIVERY** — HTTP `accepted` then `duplicate`. Stored economic events = 1. State transitions = 1. Exception `DUPLICATE_EVENT`.

**OUT_OF_ORDER** — capture is stored and classified delayed. Authorization is accepted. Replay applies capture. Final state `CAPTURED`. Exceptions `OUT_OF_ORDER_EVENT` and `MISSING_EVENT` (`payment.authorized`). Payment state is never written by the simulator.

**CONFLICT** — HTTP 409. Original amount unchanged. Payment stays `CREATED`. `WEBHOOK_CONFLICT` is audited. Exception `CONFLICTING_EVENT`.

**RETRY_FAILURE** — HTTP 500 `TEMPORARY_PROCESSING_FAILURE` on first delivery. Retry row scheduled. Worker tick succeeds. Event `PROCESSED`, payment `CREATED`. Exception `PROCESSING_FAILURE` remains (not auto-resolved).

**PERMANENT_FAILURE** — HTTP 500 on first delivery. Worker tick fails again. At `maxAttempts = 2` the retry is `DEAD_LETTERED`. Exception `RETRY_EXHAUSTED`. The webhook row remains.

**MULTI_PAYMENT** — payments A and B reach `CAPTURED` independently. A's events never appear on B.

## Failure injection

Failures are explicit and deterministic. There is no random fault injection.

| Plan | Behavior |
| --- | --- |
| `NONE` | Every processing attempt runs normally |
| `FAIL_THEN_SUCCEED` with `failAttempts: 1` | Attempt 1 throws a retryable error; attempt 2 runs replay |
| `EXHAUST_RETRIES` | Every attempt throws the same retryable error until max attempts |

Backoff is the existing policy: `delayMs = min(maxDelayMs, baseDelayMs * 2^(attempt-1))`. No jitter.

## Why synthetic data

Live provider payloads are untrusted, rate-limited, and expensive to reproduce. Synthetic events let HOOKX demonstrate duplicate delivery, out-of-order capture, payload conflict, retry, and dead-letter without implying a live PSP or a real settlement.

The JSON body includes `"synthetic": true` and `"infrastructure": "SYNTHETIC"`. The API must not describe these as live payment-provider events.

## Mapping to reliability problems

| Reliability problem | Scenario |
| --- | --- |
| Provider retries the same webhook | `duplicate` |
| Capture arrives before authorization | `out-of-order` |
| Same id, different body | `conflict` |
| Internal processing blip | `retry` |
| Processing never succeeds | `dead-letter` |
| Two customers in one stream | `multi` |
