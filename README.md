# HOOKX

Payment Webhook Reliability Engine

Webhook delivery is not the same thing as reliable financial processing. HOOKX verifies a payment webhook, stores it once, applies deterministic state transitions, retries transient failures, and records an audit trail. Operators may request a read-only AI explanation of stored evidence. AI does not decide or change financial state.

## PROBLEM

Payment providers deliver webhooks that can be duplicated, delayed, out of order, conflicting, or transiently unprocessable. Treating each delivery as an authoritative ledger write produces incorrect payment state. Reliability has to be an ingest and processing problem, not a UI overlay.

## SOLUTION

HOOKX focuses on:

- verified ingestion (HMAC on the raw body, before parse)
- idempotency (`provider + external_event_id`)
- deterministic processing (`@hookx/state-machine`)
- controlled retries with backoff and dead-letter
- replay from the stored event log
- exception classification
- append-only audit
- evidence-based investigation (read-only)

It does not process live checkouts, call Razorpay REST APIs, or move money.

## ARCHITECTURE

```
Provider
  → Verification
  → Adapter
  → Normalization
  → Idempotent ingestion
  → Deterministic processing
  → Retry / replay
  → Exception
  → Audit
  → Investigation
  → Operator
```

Razorpay-specific code stops at the adapter (`packages/webhook/src/razorpay/`). The domain and state machine do not import HTTP, UI, a database, or the AI investigator.

See [docs/architecture.md](docs/architecture.md).

## KEY GUARANTEES

These are covered by automated tests (`pnpm test`). They are not SLAs.

| Guarantee | Meaning |
| --- | --- |
| **IDEMPOTENCY** | Identical redelivery (`provider + external_event_id`, same payload hash) does not apply a second economic transition. |
| **CONFLICT SAFETY** | Same identity, different payload hash: original row kept; incoming payload not stored. |
| **DETERMINISM** | The same normalized events and transition table produce the same processing result. |
| **AUDITABILITY** | Ingest, processing, exception, retry, replay, and investigation writes append audit rows. |
| **AI SAFETY** | Investigation is requested, read-only, and off the ingest path. It cannot capture, refund, or update payment state. |

Not claimed: production readiness, guaranteed delivery, live PSP checkout, cryptographic ledger immutability, or availability percentages.

## GOLDEN DEMO

The fastest reviewer path is a **synthetic** Razorpay-shaped fail-once run through the real pipeline.

1. Install Node.js 22+, pnpm 11, PostgreSQL 16+.
2. `pnpm install`
3. `cp .env.example .env` and set `HOOKX_DATABASE_URL`, `HOOKX_SYNTHETIC_WEBHOOK_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` (any local placeholder).
4. Create the database named in `HOOKX_DATABASE_URL` (`createdb hookx` or equivalent).
5. `pnpm migrate`
6. `pnpm dev`
7. Open `http://127.0.0.1:5173/demo`
8. Click **RUN DEMO**
9. Open **VIEW INCIDENT** and **VIEW TIMELINE**
10. Click **INVESTIGATE**

This is a **SYNTHETIC DEMONSTRATION**, not live payment processing. Nothing is sent to Razorpay. Details: [docs/golden-demo.md](docs/golden-demo.md).

## TECH STACK

TypeScript (strict), Node.js 22+, pnpm workspaces, Hono, React, Vite, black/white CSS (`#000000` / `#FFFFFF`), Vitest, ESLint, PostgreSQL, Drizzle ORM.

## LOCAL SETUP

Requires Node.js 22+, pnpm 11, PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env
# set HOOKX_DATABASE_URL, HOOKX_SYNTHETIC_WEBHOOK_SECRET, RAZORPAY_WEBHOOK_SECRET
createdb hookx   # if the database does not exist
pnpm migrate
pnpm dev
```

`pnpm dev` starts the API (`http://127.0.0.1:8787`) and the operator console (`http://127.0.0.1:5173`) in parallel. `pnpm migrate` applies schema; it does not create the database.

`.env` is gitignored. Names only: `.env.example`. Storage notes: `packages/storage/README.md`.

## TESTING

One command runs unit tests and PostgreSQL integration tests (they create and drop dedicated databases; `CREATEDB` required):

```bash
pnpm test
```

Also:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

See [docs/test-matrix.md](docs/test-matrix.md). GitHub Actions runs the same four gates against a disposable PostgreSQL 16 service.

## LIMITATIONS

- Synthetic webhook fixtures only. Razorpay adapter: **not live-tested**.
- No production deployment, authentication, rate limiting, or HA.
- No live payment processing, capture, or refund APIs.
- Supported Razorpay webhook events: `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`. There is no Razorpay `payment.created`; HOOKX does not invent one.
- HTTP API and console are unauthenticated local tools.
- Retry ticks are explicit (ingest path plus lab/API worker ticks), not a separate cluster scheduler.
- Default AI investigator is a stub; OpenAI is optional and advisory.
- Audit is append-only application history, not a cryptographic hash chain.

Further reading: [docs/architecture.md](docs/architecture.md) · [docs/golden-demo.md](docs/golden-demo.md) · [docs/reviewer-guide.md](docs/reviewer-guide.md) · [docs/api.md](docs/api.md) · [docs/error-codes.md](docs/error-codes.md) · [docs/providers/razorpay.md](docs/providers/razorpay.md) · [docs/test-matrix.md](docs/test-matrix.md) · [docs/README.md](docs/README.md)
