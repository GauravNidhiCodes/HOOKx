# HOOKX

Payment webhook infrastructure that detects, contains, and recovers from delivery failures.

## Problem

Payment providers deliver webhooks that can be duplicated, delayed, out of order, conflicting, or transiently unprocessable. Treating each delivery as an authoritative ledger write produces incorrect payment state. Reliability has to be an explicit ingest and processing problem, not a UI concern.

## What It Does

HOOKX verifies a webhook, normalizes it behind a provider adapter, persists it idempotently, and applies deterministic state transitions. Failures become exceptions, retries, or replay. Every consequential step is audited. Operators inspect incidents and may request a read-only AI explanation of stored evidence. AI does not decide or change financial state.

## Architecture

```
Provider → Adapter → Ingestion → Domain → Processing → Exceptions → Recovery → Audit → Investigation → Operator
```

- **Provider / adapter.** A Razorpay webhook adapter and the synthetic provider stop at the adapter. The domain sees a normalized event. The reliability engine is provider-agnostic.
- **Ingestion.** Signature verification on the raw body, then validation, persistence, and processing.
- **Domain / processing.** Pure state machine and replay. No HTTP, UI, database, or AI imports.
- **Exceptions / recovery.** Deterministic classification, retries with backoff, dead-letter, explicit replay.
- **Audit / investigation / operator.** Append-only audit, optional read-only AI investigation, black-and-white console.

See `docs/architecture.md`.

## Reliability Guarantees

Implemented today:

- Idempotent ingest identity (`provider + external_event_id`). Identical redelivery does not apply a second economic transition.
- Conflicting payload for the same identity is rejected; the stored row is not overwritten.
- Deterministic payment transitions (`CREATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED`).
- Exact money as `bigint` minor units plus ISO 4217 currency.
- Signature verification before parse, normalize, or store.
- Out-of-order events delayed and replayed from the stored log.
- Retry with exponential backoff; dead-letter after the configured policy.
- Append-only application audit for ingest, processing, exception, retry, replay, and investigation.
- AI investigation is requested, read-only, and off the ingest path.

Not claimed: production readiness, guaranteed delivery, live PSP checkout APIs, cryptographic ledger immutability, or SLA percentages.

## Failure Lab

`/failure-lab` is a labelled **synthetic** environment. Most scenarios sign lab webhooks and post them through `POST /webhooks/SYNTHETIC`. Scenario `RAZORPAY_SHAPED_DUPLICATE` posts Razorpay-shaped synthetic envelopes through `POST /webhooks/razorpay` (the real adapter). It does not call Razorpay. Payment ids are `SYNTHETIC:pay:lab-{runId}`.

The architecture demo is **TRANSIENT FAILURE**: controlled fail-once processing, retry, recovery, incident, timeline, optional AI investigation. See `docs/failure-lab.md` and `docs/demo.md`.

## Golden Demo

`/demo` runs Failure Lab scenario `GOLDEN_DEMO`: a unique synthetic Razorpay-shaped `payment.authorized` webhook through `POST /webhooks/razorpay`, lab-only fail-once injection, real retry, duplicate redelivery, audit, incident timeline, and optional read-only AI investigation. The browser does not fake the lifecycle. HOOKX does not invent `payment.created`, so recovery is the stored event reaching `PROCESSED` (payment projection stays empty). **NO DUPLICATE ECONOMIC EFFECT** is shown only after the store confirms one event and zero payment state changes. See `docs/golden-demo.md`.

## AI Investigator

Investigation explains persisted evidence. Labels in the console: **AI-GENERATED INVESTIGATION**, **READ-ONLY**, **NO FINANCIAL STATE CHANGES**. Recommended actions are not executable. A missing model or malformed output does not mutate payments. Default implementation is a stub; OpenAI is optional and isolated. See `docs/ai-investigator.md`.

## Tech Stack

TypeScript (strict), Node.js 22+, pnpm workspaces, Hono, React, Vite, custom black/white CSS, Vitest, ESLint, PostgreSQL, Drizzle ORM.

## Running Locally

Requires Node.js 22+, pnpm 11, and PostgreSQL 16+ for persistence.

Create the database named in `HOOKX_DATABASE_URL` if it does not exist (`createdb hookx` or equivalent). `db:migrate` applies schema; it does not create the database.

```bash
pnpm install
cp .env.example .env
pnpm --filter @hookx/storage db:migrate
pnpm dev
```

- API: `http://127.0.0.1:8787`
- Operator console: `http://127.0.0.1:5173`

Set `HOOKX_DATABASE_URL` and `HOOKX_SYNTHETIC_WEBHOOK_SECRET` in `.env` (gitignored). See `.env.example`. Details: `packages/storage/README.md`. After pulling schema changes, run `db:migrate` again on any existing database. Tests drop and recreate their own databases.

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Integration and Failure Lab tests talk to PostgreSQL. They create and drop dedicated databases and require `CREATEDB`. They are not skipped if the database is down. See `docs/test-matrix.md`.

GitHub Actions runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` against PostgreSQL 16.

## Synthetic Data

Simulator and Failure Lab rows are labelled **SYNTHETIC**. They are not live customer payments and must not be read as production Razorpay data. Failure Lab reset deletes only `SYNTHETIC:pay:lab-*` rows.

## Limitations

- Not a production payment processor or hosted PSP.
- Razorpay support is a webhook adapter (signature + normalize onto the existing event contract), not Razorpay REST/checkout. It has been tested with synthetic fixtures only.
- Audit is append-only from application behavior, not a cryptographic hash chain.
- Default AI investigator is a stub; live model output is optional and advisory.
- Operator console is a local investigation workspace, not a multi-tenant SaaS product. The HTTP API is unauthenticated; do not expose it on a public network without an authenticating proxy.
- Retry worker ticks are explicit (ingest path plus lab/API ticks), not a separate cluster scheduler.

Further reading: `docs/README.md`.
