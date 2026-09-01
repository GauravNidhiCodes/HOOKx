# Reviewer guide

Answers a Razorpay engineer can check against this repository. Claims here map to code, not to a product pitch.

HOOKX is a local **Payment Webhook Reliability Engine**. STATUS: Working prototype / technical demonstration. It is not a Razorpay product, not live-tested against a Razorpay account, not a live checkout, and not a production payment processor. HOOKX is not an official Razorpay product and is not endorsed by Razorpay.

## Terminology

Stored enums are the source of truth. Operator copy should use these words, not synonyms.

| Reviewer word | Stored / HTTP term |
| --- | --- |
| received | Event `processingStatus` `RECEIVED`; audit `WEBHOOK_RECEIVED` |
| verified | Signature result `VERIFIED`; lifecycle `SIGNATURE_VERIFIED`. Unverified bytes are not stored. |
| processing | Event `processingStatus` `PROCESSING`; retry row `PROCESSING` while a worker holds a lease |
| failed | HTTP ingest `TEMPORARY_PROCESSING_FAILURE`; exception `PROCESSING_FAILURE`; lifecycle `PROCESSING_FAILED` |
| retrying | Retry `RETRY_SCHEDULED` (due later) or `PROCESSING` (claimed). UI may say **RETRY** / **ATTEMPT N FAILED**. |
| recovered | Retry `SUCCEEDED`; event `PROCESSED` after a successful retry |
| exhausted | Exception `RETRY_EXHAUSTED`; retry `DEAD_LETTERED`. UI: **RETRY EXHAUSTED**. |
| duplicate | Store `DUPLICATE`; HTTP 200 `duplicate`; exception `DUPLICATE_EVENT` |
| conflict | Store `CONFLICT`; HTTP 409 `conflict` / code `CONFLICT`; exception `CONFLICTING_EVENT` |
| investigated | An investigation row exists (`INVESTIGATION_RECORDED`). There is no payment status `INVESTIGATED`. |

Do not treat HTTP `PROCESSING_FAILED` as a code; that string is a log lifecycle. The HTTP code is `TEMPORARY_PROCESSING_FAILURE`. The exception code is `PROCESSING_FAILURE`. See [error-codes.md](error-codes.md).

## Why webhook reliability instead of just webhook ingestion?

A provider can deliver the same event twice, deliver events out of order, send a conflicting payload for an already-stored identity, or fail after the HTTP 200. Ingestion that only parses JSON and writes a row does not protect financial projections.

HOOKX separates:

1. authenticity (HMAC on the raw body)
2. identity (`provider + external_event_id`)
3. deterministic application (`replayEvents` / `processEvent`)
4. retry of **processing**, not of unverified bytes
5. classification and audit

Webhook delivery ≠ reliable financial processing.

## How is idempotency enforced?

Identity is `provider + external_event_id`. PostgreSQL `UNIQUE (provider, external_event_id)` on `webhook_events` is the authority (`packages/storage/drizzle/0000_webhook_events.sql`). The store classifies **NEW**, **DUPLICATE** (same payload hash), or **CONFLICT** (different hash). Duplicate deliveries do not run a second economic transition.

Razorpay-shaped events take `x-razorpay-event-id` as the external id (`packages/webhook/src/razorpay/`).

## What happens during duplicate delivery?

Same identity, same payload hash: HTTP 200 `{ status: "duplicate", requestId }`. One stored row. Exception `DUPLICATE_EVENT` may be recorded. Payment projection is not advanced a second time. Covered by Failure Lab `DUPLICATE_DELIVERY`, Razorpay-shaped duplicate, Golden Demo redelivery, and ingest tests.

## What happens during conflicting delivery?

Same identity, different payload hash: HTTP 409 `{ status: "conflict", requestId, code: "CONFLICT" }`. The original row is kept. Incoming bytes are not stored as a second event. Exception `CONFLICTING_EVENT`. Covered by Failure Lab `CONFLICTING_EVENT` and Razorpay e2e.

## How does retry work?

If processing throws a retryable error after the event is stored, ingest schedules a retry (`RETRY_SCHEDULED`) and returns HTTP 500 `TEMPORARY_PROCESSING_FAILURE`. A worker tick (`runRetryTick` in `packages/storage/src/retry/worker.ts`) claims due rows (`SELECT … FOR UPDATE SKIP LOCKED`), applies deterministic backoff, and either succeeds, reschedules, or dead-letters.

Ticks run on the ingest path when a retry row is due and from Failure Lab / demo workers (clock advanced to `nextAttemptAt`). There is no separate cluster scheduler.

Policy: `HOOKX_RETRY_MAX_ATTEMPTS`, `HOOKX_RETRY_BASE_DELAY_MS`, `HOOKX_RETRY_MAX_DELAY_MS`, `HOOKX_RETRY_LEASE_MS`.

Lab injection (`FAIL_ONCE` / `ALWAYS_FAIL`) applies only to `SYNTHETIC:pay:lab-*` with provider `SYNTHETIC` or `razorpay`. Live-shaped `pay_…` and simulator `SYNTHETIC:pay:sim-*` are never injected.

## How is replay different from retry?

**Retry** re-attempts processing of an already stored event that failed temporarily. It does not create a new identity row.

**Replay** (`replayEvents` in `@hookx/state-machine`, called from `processPaymentEvents`) loads **all** stored events for one payment, orders them, and projects state. It does not delete or overwrite webhook identity rows and does not invent transitions. Out-of-order capture is `DELAYED` until a prerequisite exists. Failure Lab `REPLAY_RECOVERY` exercises this.

## Why is the engine deterministic?

`processEvent` and `replayEvents` are pure functions of normalized events and the transition table. `detectException` is a pure function of injected facts. The same log and rules produce the same decisions. Tests in `@hookx/state-machine` and `@hookx/exceptions` lock this. AI output is not an input to those functions.

## Where does AI fit?

Off the ingest path. An operator (or Golden Demo) calls `POST /incidents/:id/investigate` or `POST /exceptions/:id/investigate`. `@hookx/investigation` reads sanitized stored evidence and writes `INVESTIGATION_RECORDED`. Default provider is a stub (`HOOKX_INVESTIGATION_PROVIDER=stub`). OpenAI is optional and advisory.

## What can AI NOT do?

It cannot verify signatures, store webhooks, apply `processEvent`, schedule retries, capture, refund, or update payment rows. Recommended actions are not executable. Labels in the console: **AI-GENERATED INVESTIGATION**, **READ-ONLY**, **NO FINANCIAL STATE CHANGES**.

## How is the system audited?

`audit_events` is append-only from application writes (`@hookx/audit` drafts persisted in `@hookx/storage`). Covered operations include ingest, duplicate/conflict, processing, exception, retry lifecycle, replay, and investigation. The operator console does not edit or delete audit rows. This is application history, not a cryptographic hash chain.

## How would another payment provider be added?

1. Implement `SignatureVerifier` and register it in `createSignatureVerifierRegistry` (`packages/webhook/src/signature/registry.ts`).
2. Implement `ProviderAdapter` producing `NormalizedWebhookEvent` and register it in `getProviderAdapter` (`packages/webhook/src/registry.ts`).
3. Wire the secret from env in `apps/api/src/index.ts` the same way as Razorpay.
4. Add fixtures and ingest tests. Do not import provider types into `@hookx/domain` or `@hookx/state-machine`.

Unknown `:provider` values have no verifier → HTTP 404 `UNSUPPORTED_PROVIDER`. They are not ingested.

## What would need to change before production?

See **Before production** below. The project is a local reliability engine and operator workspace.

## Before production

Genuine gaps:

- **Authentication** — HTTP API and console are unauthenticated.
- **Rate limiting** — ingest has a 256 KiB body cap only.
- **Provider onboarding** — two adapters (`SYNTHETIC`, `razorpay`); Razorpay **not live-tested**.
- **Secret management** — env files locally; no rotation / dual-secret verification.
- **Operational alerting** — no paging, no external metrics backend.
- **High availability** — single local Node process; retry ticks are in-process.
- **Load testing** — not done.
- **Provider edge cases** — limited Razorpay event set; no HMAC timestamp on Razorpay signatures (Razorpay does not send one).
- **Deployment infrastructure** — no production deploy, no Docker requirement, no cloud runbooks.

Do not treat `HOOKX_LIVE_PROVIDERS` as a go-live switch. It only changes origin **labels**.

## How to run

Root README **Quick start** and [golden-demo.md](golden-demo.md) steps 1–10. One-command app start: `pnpm dev` (after `pnpm install`, env, `createdb`, `pnpm migrate`). Tests: `pnpm test`.
