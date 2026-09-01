# Failure Lab

The Failure Lab is a controlled synthetic environment where an operator triggers realistic webhook failure scenarios and watches HOOKX handle them through the **real** ingest pipeline.

**The Failure Lab never sends real payment requests.**

It never calls Razorpay. It never creates live payments. It never requires Razorpay dashboard credentials. Every lab payment id is prefixed `SYNTHETIC:pay:lab-` so it cannot be mistaken for a customer payment. Scenario `RAZORPAY_SHAPED_DUPLICATE` uses PROVIDER `razorpay` and DATA SOURCE SYNTHETIC.

The entire operator surface is labelled **SYNTHETIC FAILURE LAB**. The page states **THIS IS SYNTHETIC**.

The architecture demonstration is scenario `TRANSIENT_FAILURE` (**SYNTHETIC · DEMO RUN**): webhook through real ingest, controlled fail-once, retry, recovery, incident, timeline, optional AI investigation. See `docs/demo.md`.

The Golden Demo is scenario `GOLDEN_DEMO` (polished operator view `/demo`): synthetic `POST /webhooks/SYNTHETIC` path, fail-once injection, retry, duplicate redelivery. See `docs/golden-demo.md`.

## Purpose

Demonstrate, with persisted evidence:

FAILURE → DETECTION → DECISION → RECOVERY → AUDIT

Supported scenarios:

| Id | Title | What is exercised |
| --- | --- | --- |
| `DUPLICATE_DELIVERY` | Duplicate delivery | Same signed webhook posted twice. Second delivery is `duplicate`. One stored event. One economic state transition. |
| `OUT_OF_ORDER` | Out-of-order delivery | Created, captured, then authorized. Capture is delayed. Replay reaches `CAPTURED`. Transitions come from the state machine, not the lab. |
| `CONFLICTING_EVENT` | Conflicting event | Same event identity, different payload hash. HTTP conflict. Original row unchanged. |
| `TRANSIENT_FAILURE` | Transient failure | Lab-only `FAIL_ONCE` injection. Processing fails, a retry is scheduled, the retry succeeds. |
| `RETRY_EXHAUSTION` | Retry exhaustion | Lab-only `ALWAYS_FAIL` injection until the **configured** retry policy is exhausted, then dead-letter. |
| `REPLAY_RECOVERY` | Replay recovery | Capture arrives before authorization. Stored events are replayed when the missing event arrives. Created is not applied twice. |
| `RAZORPAY_SHAPED_DUPLICATE` | Razorpay-shaped duplicate | Synthetic Razorpay `payment.authorized` posted twice through `POST /webhooks/razorpay`. Real adapter. Data source SYNTHETIC. One stored event. No invented `payment.created`. |
| `GOLDEN_DEMO` | Golden Demo | Synthetic `payment.created` through `POST /webhooks/SYNTHETIC` with lab-only `FAIL_ONCE`, retry recovery, then identical redelivery classified duplicate. Operator UI: `/demo`. |

## Synthetic-data policy

- Payment ids: `SYNTHETIC:pay:lab-{runId}`
- Event ids: `SYNTHETIC:evt:lab-{runId}-…` for simulator and Golden Demo scenarios; `SYNTHETIC:evt:lab-{runId}-1` for Razorpay-shaped scenarios
- Provider: `SYNTHETIC` for simulator scenarios and `GOLDEN_DEMO`; `razorpay` for `RAZORPAY_SHAPED_DUPLICATE` (DATA SOURCE remains SYNTHETIC)
- JSON bodies include `"synthetic": true`
- Simulator ids (`SYNTHETIC:pay:sim-*`) are **not** Failure Lab data and are not deleted by reset

Each run generates a new UUID so the same scenario can be repeated without colliding with previous rows.

## Pipeline

The lab does not write payment, exception, retry, or audit rows directly.

```
Failure Lab UI
    → POST /failure-lab/run
    → signed deliveries
    → POST /webhooks/SYNTHETIC  (or POST /webhooks/razorpay for RAZORPAY_SHAPED_DUPLICATE)
    → signature verification
    → adapter normalize
    → persistence
    → processing / state machine
    → retry worker ticks (when a retry is due)
    → replay (when the log requires it)
    → audit + exceptions
    → execution report from stored state
```

`GET /failure-lab` returns the catalog. `GET /failure-lab/runs/:id` returns an in-memory report for the current API process. `POST /failure-lab/reset` deletes lab rows only.

Unknown scenario names return `400 UNKNOWN_FAILURE_LAB_SCENARIO`.

## Failure injection

Processing failures used by the lab are **not** a client header and are **not** part of default ingest.

The lab constructs an isolated `processPaymentEvents` wrapper with an explicit mode:

| Mode | Used by | Behavior |
| --- | --- | --- |
| `NONE` | duplicate, out-of-order, conflict, replay, Razorpay-shaped duplicate | Real processing only |
| `FAIL_ONCE` | transient failure, golden demo | First lab payment attempt throws `RetryableProcessingError`; later attempts process normally |
| `ALWAYS_FAIL` | retry exhaustion | Every lab payment attempt throws until the retry policy dead-letters |

Injection runs only when **both** are true:

1. payment id starts with `SYNTHETIC:pay:lab-`
2. provider is `SYNTHETIC` or `razorpay`

A live-shaped Razorpay id (`pay_…`), a non-lab webhook, or a simulator `SYNTHETIC:pay:sim-*` id cannot activate injection. The wrapper is attached only to the inner Hono app used for that lab/demo run. Default ingest `processPaymentEvents` is unchanged.

The mode is chosen by the server from the scenario id. Clients cannot supply an arbitrary failure function.

## Retry behavior

Retry uses the API process retry policy (`HOOKX_RETRY_MAX_ATTEMPTS`, `HOOKX_RETRY_BASE_DELAY_MS`, `HOOKX_RETRY_MAX_DELAY_MS`). The lab does not invent a countdown.

After deliveries, the lab drains due retries by advancing the worker clock to each row’s `nextAttemptAt` (no cosmetic sleep). Attempt number, failure reason, next retry, and terminal status in the report are read from stored retry / dead-letter rows.

`TRANSIENT_FAILURE` expects ingest `TEMPORARY_PROCESSING_FAILURE`, then `RETRY_SCHEDULED` → `RETRY_ATTEMPTED` → `RETRY_SUCCEEDED`.

`RETRY_EXHAUSTION` expects retries until `attemptCount === maxAttempts`, then `DEAD_LETTERED` / `RETRY_EXHAUSTED`.

## Replay behavior

Out-of-order capture is `DELAYED` until authorization is stored. Replay is the existing `processPaymentEvents` path over the stored log. The lab does not call the state machine as a shortcut.

`REPLAY_RECOVERY` snapshots payment state after created+captured, then posts authorized. Before/after in the report is that snapshot versus the stored payment. A second `CREATED` transition must not appear.

## Cleanup / reset safety

`POST /failure-lab/reset` body:

```json
{ "confirm": "SYNTHETIC_FAILURE_LAB" }
```

Any other confirmation returns `400 RESET_CONFIRMATION_REQUIRED`.

Reset deletes only rows whose payment id matches `SYNTHETIC:pay:lab-%` (and related retry, dead-letter, exception, investigation, and audit rows for those webhooks), including Razorpay-adapter lab rows that use that payment-id prefix. It never runs `DROP DATABASE`, never truncates tables, and never deletes `SYNTHETIC:pay:sim-*`.

Append-only triggers on `audit_events`, `exceptions`, and `investigations` still forbid ordinary deletes. Reset enables a **transaction-local** setting `hookx.allow_failure_lab_purge`. The triggers then allow DELETE only when that setting is on **and** the row’s payment id (or the linked webhook’s payment id) is `SYNTHETIC:pay:lab-*`. Simulator and live rows remain undeletable even if the setting is on.

Reports held in API memory are cleared. The operator UI requires the same confirmation string.

## How to run locally

1. PostgreSQL running, `.env` with `HOOKX_DATABASE_URL` and `HOOKX_SYNTHETIC_WEBHOOK_SECRET`
2. `pnpm dev` from the repository root
3. Open `http://127.0.0.1:5173/failure-lab`
4. Run a scenario. The report, log, and incident link are loaded from that execution.
5. Optional: `VIEW INCIDENT` opens the existing `/incidents/:id` timeline. There is no second timeline implementation.

The lab reuses the synthetic webhook secret already required for `POST /webhooks/SYNTHETIC`. The Golden Demo uses that same secret. Scenario `RAZORPAY_SHAPED_DUPLICATE` also requires `RAZORPAY_WEBHOOK_SECRET` (otherwise `503 RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE`). It does not add a Razorpay dashboard connection.

## Security restrictions

- Synthetic only. Lab identifiers are distinct from simulator and live ids.
- Failure injection cannot be enabled by a webhook header or payload flag.
- Injection is refused unless the event is a Failure Lab synthetic payment.
- Reset is filtered. Unfiltered `DELETE FROM` is not used.
- The lab does not expose internal repository methods over HTTP.
- Results after RUN come from stored execution. The UI does not hardcode success rates, latencies, or incident counts.

See also `docs/simulation.md` (CLI simulator) and `docs/operator-console.md`.
