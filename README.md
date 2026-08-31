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
```

The stages after the domain skeleton (HTTP ingest, signature verification, persistence, ordering, retry, recovery, audit) are not implemented in this revision.

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

What this revision does not implement or claim:

- Production readiness
- Guaranteed delivery
- Live Razorpay (or any provider) processing
- Webhook HTTP ingestion or signature verification
- Database persistence
- Event ordering, retry, or recovery workers
- Production-scale performance

## Repository structure

```
apps/
  api/                 Hono HTTP shell (no webhook ingest)
  web/                 React/Vite operator shell (no live data)
packages/
  domain/              Money, identifiers, payment states
  webhook/             Normalized event + webhook identity
  state-machine/       Transition table + applyWebhookEvent
  testkit/             SYNTHETIC fixtures
```

`storage`, `providers`, `audit`, and `observability` packages are omitted until those layers exist.

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
| Intended persistence (not implemented) | PostgreSQL + Drizzle ORM |

Next.js, shadcn, Tailwind palettes, Bootstrap, Material UI, and Chakra are not used.

## Local setup

Requirements:

- Node.js 22 or later (current LTS recommended)
- pnpm 11

```bash
pnpm install
```

Copy `.env.example` to `.env` if you need to change the API bind address. PostgreSQL is not required for this foundation.

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
```

## Current implementation status

| Area | Status |
| --- | --- |
| Domain types (money, ids, states) | Implemented |
| Normalized webhook event | Implemented |
| Deterministic state machine | Implemented |
| Synthetic fixtures | Implemented |
| HTTP webhook ingest | Not implemented |
| Signature verification | Not implemented |
| Provider adapters (Razorpay, etc.) | Not implemented |
| PostgreSQL / Drizzle persistence | Not implemented |
| Ordering, retry, recovery | Not implemented |
| Audit trail | Not implemented |
| Operator dashboard / live payments | Not implemented |
| Production deployment | Not implemented |

The web shell is a black-and-white design system surface only. It does not display payment records or metrics.
# HOOKZ
