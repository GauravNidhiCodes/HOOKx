# HOOKX

HOOKX is a payment webhook reliability engine. It is infrastructure for turning unreliable provider webhook deliveries into a deterministic internal payment state.

This repository is a foundation: domain types, a pure state machine, synthetic fixtures, and application shells. It is not a production payment processor.

## Problem

Payment providers send webhook events, but real-world delivery can be duplicated, delayed, out of order, malformed, retried, missing, or conflicting. Treating those payloads as an authoritative ledger produces incorrect payment state.

HOOKX exists to sit between the provider and internal systems:

```
Payment Provider
      ↓
Webhook Gateway
      ↓
Signature Verification
      ↓
Schema Validation
      ↓
Deduplication
      ↓
Ordering
      ↓
Deterministic State Machine
      ↓
Reliable Payment State
      ↓
Retry / Recovery
      ↓
Immutable Audit Trail
      ↓
      Exception Detection
      ↓
Read-only Investigation   (on demand; never on the ingest path)
```

Persistence, out-of-order replay, synthetic signature verification, HTTP ingest, PostgreSQL-backed retry/recovery, an append-only audit trail, deterministic exception classification, read-only investigation, and an operator console are implemented. Live PSP adapters are not.

## Architecture

The core is domain-first. The state machine is a pure function of explicit inputs:

```
event + current state + seen webhook identities
        ↓
ACCEPTED | REJECTED | IGNORED_DUPLICATE
```

That function does not import React, HTTP libraries, PostgreSQL, provider SDKs, or the system clock. Timestamps on an event are values supplied by the caller (`occurredAt`, `receivedAt`). The same inputs always produce the same result.

Application shells (`apps/api`, `apps/web`) are transport and presentation only. They do not own transition rules.

## Core reliability guarantees (current)

What this revision actually implements:

- **Explicit lifecycle.** Payments move through `CREATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, and `REFUNDED` using a published transition table. Unknown transitions return `REJECTED`. State is not mutated inside the function; callers apply `ACCEPTED` results.
- **Idempotent webhook identity.** Identity is `provider + externalEventId`. The first unseen identity may be `ACCEPTED`. The same identity again is `IGNORED_DUPLICATE` and does not describe a second economic transition.
- **Provider isolation.** Core types accept a normalized webhook event only. Provider-specific payload fields are not part of the domain contract.
- **Exact money.** Amounts are `bigint` minor units plus an uppercase ISO 4217 alphabetic currency code. Floating-point types are not used for money.
- **Determinism.** Transition results depend only on the provided event, current state, and seen-identity set.
- **Durable webhook identity.** Normalized events are stored under a PostgreSQL uniqueness constraint on `provider + external_event_id`. Identical redeliveries are duplicates; conflicting hashes are conflicts. The original row is not overwritten.
- **Out-of-order replay.** Stored events are ordered by `occurredAt` with a webhook-identity tie-break, then replayed through `processEvent`. Early events are `DELAYED`, not silently applied. Impossible transitions after ordering require investigation.
- **Signature verification.** External webhooks are verified on the original raw body before JSON parse, normalization, or storage. The synthetic adapter uses HMAC-SHA256 with an injected-time replay window. Razorpay uses HMAC-SHA256 over the raw body and `X-Razorpay-Signature` (see `docs/razorpay.md`).
- **Retry and recovery.** A valid persisted webhook that fails temporarily is claimed with `SELECT … FOR UPDATE SKIP LOCKED`, retried with deterministic exponential backoff, and dead-lettered after max attempts or a permanent failure. Duplicate deliveries cannot create a second event row or a second payment transition.
- **Append-only audit trail.** Live ingest and retry write immutable `audit_events` rows (received, duplicate, conflict, state change, delay, retry lifecycle). Replay does not rewrite that history. This is not a cryptographic ledger.

What this revision does not implement or claim:

- Production readiness
- Guaranteed delivery
- Live Razorpay REST APIs / checkout (webhook ingest is implemented; see `docs/razorpay.md`)
- Cryptographic audit immutability
- Production-scale performance

## Repository structure

```
apps/
  api/                 Hono HTTP + webhook pipeline + retry/audit inspection
  web/                 React/Vite operator console (exceptions, incidents, payments, events, Failure Lab)
packages/
  domain/              Money, identifiers, payment states
  webhook/             Normalized event, identity, signature verifiers
  state-machine/       Transition table + processEvent + replayEvents
  testkit/             SYNTHETIC fixtures
  simulator/           Synthetic webhook scenarios + generator
  storage/             PostgreSQL webhook events + payments + retry/dead-letter + audit + exceptions
  audit/               Append-only audit event model
  exceptions/          Deterministic exception classification
  investigation/       Read-only AI investigation of exceptions
  observability/       Structured logs + incident timeline composition
```

Live PSP checkout APIs are not implemented. Razorpay webhook ingest is; see `docs/razorpay.md`.

## Technology stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Runtime | Node.js 22+ (developed on current LTS) |
| Workspace | pnpm workspaces |
| HTTP | Hono |
| UI | React + Vite + custom CSS |
| Tests | Vitest |
| Lint | ESLint |
| Persistence | PostgreSQL + Drizzle ORM |

Next.js, shadcn, Tailwind palettes, Bootstrap, Material UI, and Chakra are not used.

## Local setup

Requirements:

- Node.js 22 or later (current LTS recommended)
- pnpm 11
- PostgreSQL 16+ for `@hookx/storage` integration tests

```bash
pnpm install
```

Copy `.env.example` to `.env` if you need to change the API bind address or database URL.

PostgreSQL is required for webhook event persistence tests. See `packages/storage/README.md`.

Run the API and web shells:

```bash
pnpm dev
```

- API: `http://127.0.0.1:8787`
- Web: `http://127.0.0.1:5173`

## Commands

From the repository root:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm simulate list
```

## Current implementation status

| Area | Status |
| --- | --- |
| Domain types (money, ids, states) | Implemented |
| Normalized webhook event | Implemented |
| Deterministic state machine | Implemented |
| Synthetic fixtures | Implemented |
| HTTP webhook ingest | Implemented (end-to-end `POST /webhooks/:provider` pipeline) |
| Signature verification | Implemented (synthetic HMAC-SHA256) |
| Provider adapters (Razorpay, etc.) | Razorpay webhook adapter implemented (ingest only; no Razorpay APIs). See `docs/razorpay.md`. |
| PostgreSQL / Drizzle persistence | Implemented (events, payments, retries, dead letters) |
| Out-of-order event replay | Implemented |
| Retry, recovery | Implemented (PostgreSQL worker + backoff) |
| Audit trail | Implemented (append-only `audit_events`) |
| Synthetic webhook simulator | Implemented (CLI → real HTTP pipeline) |
| Deterministic exception detection | Implemented (rules + PostgreSQL + read APIs) |
| Read-only AI investigation | Implemented (stub default; optional isolated LLM adapter) |
| Operator console | Implemented (exception queue, incidents/timeline, payment workspace, event inspector, Failure Lab; no fake KPIs) |
| Observability / incident timeline | Implemented (structured logs, correlation ids, composed timelines; no fabricated metrics) |
| Failure Lab | Implemented (synthetic scenarios through real ingest, isolated failure injection, lab-only reset) |
| Production deployment | Not implemented |

The web shell is a black-and-white operator console. It reads exceptions, incidents, payments, webhook events, audit history, retries, and investigations from the API. Incident detail can request a read-only AI investigation (`docs/ai-investigator.md`). The Failure Lab at `/failure-lab` posts synthetic webhooks through the real ingest pipeline. See `docs/operator-console.md`, `docs/observability.md`, and `docs/failure-lab.md`. It does not display fabricated volume or success metrics.
