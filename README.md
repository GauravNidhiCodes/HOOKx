# HOOKX

Payment Webhook Reliability Engine

[![CI](https://github.com/GauravNidhiCodes/HOOKZ/actions/workflows/ci.yml/badge.svg)](https://github.com/GauravNidhiCodes/HOOKZ/actions/workflows/ci.yml)

HOOKX verifies payment webhooks, stores each event once, and applies deterministic financial state. Duplicate delivery does not create a second economic effect.

Webhook delivery is not reliable ledger processing. Providers retry, delay, reorder, and send conflicting payloads. HOOKX treats that as an ingest problem: HMAC on the raw body, idempotent persist, a state machine, retries, and an append-only audit. **AI does not decide whether an event matches or succeeds.** Deterministic application logic is the source of truth. AI only explains stored exceptions, off the ingest path.

**STATUS: Working prototype / technical demonstration.** Not a production payment processor. HOOKX is not an official Razorpay product and is not endorsed by Razorpay.

Run the Golden Demo: `pnpm install` → create PostgreSQL → `pnpm migrate` → `pnpm dev` → [http://127.0.0.1:5173/demo](http://127.0.0.1:5173/demo) → **RUN DEMO**.

## The problem

Payment providers deliver webhooks that can be duplicated, delayed, out of order, conflicting, or transiently unprocessable. Treating each HTTP POST as an authoritative ledger write produces incorrect payment state. Reliability has to sit in verification, storage, and processing — not in the UI.

## The solution

HOOKX:

- verifies HMAC on the original raw body before JSON parse
- normalizes through a provider adapter (`SYNTHETIC`, Razorpay)
- stores once on `provider + external_event_id`
- applies transitions in `@hookx/state-machine`
- retries transient failures and dead-letters permanent ones
- replays from the stored event log
- classifies exceptions deterministically
- appends audit rows for ingest, processing, retry, and investigation
- offers a read-only AI explanation of already-stored evidence

It does not process live checkouts, call Razorpay REST APIs, or move money.

## Architecture

```
PAYMENT PROVIDER
      ↓
   WEBHOOK
      ↓
    VERIFY
      ↓
   NORMALIZE
      ↓
IDEMPOTENT INGEST
      ↓
DETERMINISTIC PROCESSOR
      ↓
 RETRY / REPLAY
      ↓
   EXCEPTION
      ↓
     AUDIT
      ↓
 INVESTIGATION
      ↓
   OPERATOR
```

Normalize is the provider adapter (`packages/webhook/`). Razorpay-specific code stops there. Domain and the state machine do not import HTTP, UI, a database, or the AI investigator.

See [docs/architecture.md](docs/architecture.md).

## How it works

HMAC on the raw body, then a provider adapter, then one insert on `provider + external_event_id`. The state machine is the only writer of financial transitions. Transient processing failures schedule retries with backoff; permanent failures dead-letter. Duplicate delivery of the same payload is a no-op. A conflicting payload keeps the original row. AI is requested later, reads stored evidence, and cannot capture, refund, or update payment rows.

## Key guarantees

Covered by `pnpm test`. These are not SLAs.

| Guarantee | Meaning |
| --- | --- |
| **Idempotency** | Same `provider + external_event_id` and payload hash: no second economic transition. |
| **Conflict safety** | Same identity, different hash: original row kept; incoming payload not stored. |
| **Determinism** | The same normalized events and transition table produce the same result. |
| **Auditability** | Ingest, processing, exception, retry, replay, and investigation append audit rows. |
| **AI safety** | Investigation is requested, read-only, and off the ingest path. It cannot capture, refund, or update payment state. |

Deterministic processing decides financial state. AI comments on evidence after the fact.

Not claimed: production readiness, guaranteed delivery, live PSP checkout, cryptographic ledger immutability, or availability percentages.

## Golden Demo

Synthetic `payment.created` through the **real** `POST /webhooks/SYNTHETIC` pipeline: HMAC with `HOOKX_SYNTHETIC_WEBHOOK_SECRET`, persist, fail-once, retry, duplicate redelivery, audit, optional investigate. Nothing is sent to Razorpay.

Requires Node.js 22+, pnpm 11, PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env
```

Set `HOOKX_DATABASE_URL` and `HOOKX_SYNTHETIC_WEBHOOK_SECRET` (local placeholders are fine). `RAZORPAY_WEBHOOK_SECRET` is only required for Razorpay-shaped ingest (`POST /webhooks/razorpay` and Failure Lab `RAZORPAY_SHAPED_DUPLICATE`), not for the Golden Demo.

```bash
createdb hookx   # database name must match HOOKX_DATABASE_URL
pnpm migrate
pnpm dev
```

Then open [http://127.0.0.1:5173/demo](http://127.0.0.1:5173/demo) and click **RUN DEMO**. Use **VIEW INCIDENT** / **VIEW TIMELINE** and **INVESTIGATE** on the same run.

`pnpm migrate` applies schema; it does not create the database. `pnpm dev` starts the API (`http://127.0.0.1:8787`) and the operator console (`http://127.0.0.1:5173`). Missing `HOOKX_SYNTHETIC_WEBHOOK_SECRET` → demo `503`. Details: [docs/golden-demo.md](docs/golden-demo.md).

## Tech stack

TypeScript (strict), Node.js 22+, pnpm workspaces, Hono, React, Vite, black/white CSS (`#000000` / `#FFFFFF`), Vitest, ESLint, PostgreSQL, Drizzle ORM.

## Quick start

Same commands as Golden Demo. Names only in [`.env.example`](.env.example); `.env` is gitignored.

| Variable | Required for |
| --- | --- |
| `HOOKX_DATABASE_URL` | `pnpm migrate`, `pnpm dev` |
| `HOOKX_SYNTHETIC_WEBHOOK_SECRET` | API process |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay-shaped ingest only (`POST /webhooks/razorpay`, Failure Lab `RAZORPAY_SHAPED_DUPLICATE`). Not required for the Golden Demo. |
| `HOOKX_TEST_DATABASE_URL` | Optional. Tests otherwise use `postgres://$USER@127.0.0.1:5432/hookx_test` |

Storage notes: [packages/storage/README.md](packages/storage/README.md).

## Testing

Unit tests and PostgreSQL integration tests (they create and drop dedicated databases; `CREATEDB` required):

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Scenario map: [docs/test-matrix.md](docs/test-matrix.md). GitHub Actions runs the same four gates against PostgreSQL 16 ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). No deploy job. No production credentials.

## Razorpay / provider support

| Provider | What exists |
| --- | --- |
| `SYNTHETIC` | Local signed fixtures and simulator |
| `razorpay` | Webhook HMAC + adapter for `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created` |

Razorpay has no `payment.created` webhook. HOOKX does not invent one. The adapter is **not live-tested** against a Razorpay account. There is no Razorpay Payments API client. HOOKX is not an official Razorpay product and is not endorsed by Razorpay.

Adapter contract: [docs/providers/razorpay.md](docs/providers/razorpay.md).

## Repository

```
apps/
  api/                 HTTP ingest, Golden Demo, Failure Lab
  web/                 operator console
packages/
  domain/              money, ids, payment states
  webhook/             verify, adapters, normalize
  state-machine/       deterministic transitions
  storage/             PostgreSQL
  audit/               append-only audit model
  exceptions/          deterministic classification
  investigation/       read-only AI explanation
  observability/       logs, incident timeline
  simulator/           synthetic scenario catalog
  testkit/             test fixtures
docs/                  architecture, API, demo, security
.github/workflows/     CI (install, typecheck, lint, test, build)
```

Index: [docs/README.md](docs/README.md). Also: [docs/api.md](docs/api.md), [docs/error-codes.md](docs/error-codes.md), [docs/ai-investigator.md](docs/ai-investigator.md), [docs/security.md](docs/security.md), [docs/failure-lab.md](docs/failure-lab.md), [docs/reviewer-guide.md](docs/reviewer-guide.md).

## Limitations

- Synthetic webhook fixtures. Razorpay adapter is not live-tested.
- No production deployment, authentication, rate limiting, or high availability.
- No live payment processing, capture, or refund APIs.
- HTTP API and console are unauthenticated local tools.
- Retry ticks are explicit (ingest path plus lab/API worker), not a cluster scheduler.
- Default investigator is a stub; OpenAI is optional and advisory.
- Audit is application history, not a cryptographic hash chain.

## Project status

STATUS: Working prototype / technical demonstration.

Local reliability engine and operator workspace. Not a production payment processor. HOOKX is not an official Razorpay product and is not endorsed by Razorpay. No license file is in the repository. There is no external contribution guide.
