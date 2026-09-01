# @hookx/exceptions

Deterministic exception classification for HOOKX webhook and payment processing.

This package decides **whether an exception exists and which code it receives**. It does not persist rows, serve HTTP, render UI, talk to providers, or call an LLM.

```
Webhook Events
      ↓
Processing / Replay
      ↓
Exception Detection     (this package: explicit rules)
      ↓
Exception Record
      ↓
Read-only Investigation   (@hookx/investigation, on demand)
      ↓
Operator UI
```

## Why classification is deterministic

`detectException(context)` is a pure function of:

- injected `detectedAt` (caller clock)
- injected `correlationId`
- provider / payment / webhook identifiers
- a list of **facts** collected at the application boundary (signature result, store outcome, replay decision, retry outcome)

It does not read the database, the network, `Date.now()`, random values, or model output. The same facts always produce the same drafts, in the same precedence order, with the same severity.

## Why AI is not responsible for classification

HOOKX is not an AI system. An LLM must not decide:

- whether an exception exists
- which `exceptionCode` it receives
- severity
- whether two incidents are the same condition

A later operator surface may use a model to **explain** an already classified exception (`@hookx/investigation`). That explanation is commentary. The stored code, severity, and identity remain the rule output.

## Exception model

`ExceptionRecord` (immutable after `createException`):

| Field | Meaning |
| --- | --- |
| `exceptionId` | UUID assigned at the persistence boundary |
| `exceptionCode` | One of the codes below |
| `severity` | Derived only from the code |
| `paymentId` | Payment id when known |
| `webhookEventId` | Stored webhook row id, or `null` if nothing was persisted |
| `provider` | Provider id, or `null` if unknown |
| `status` | `OPEN` / `ACKNOWLEDGED` / `RESOLVED` |
| `reason` | Structured `A-Z0-9_` code (more specific than the exception code when useful) |
| `detectedAt` | Injected detection instant |
| `correlationId` | Request/operation id from the application boundary |
| `metadata` | Small non-sensitive context (same sanitizer as audit) |
| `identity` | Deduplication key |

Detection returns `ExceptionDraft` values (no `exceptionId`). Persistence assigns the id.

Secrets, signatures, credentials, and complete raw payment payloads are never stored on an exception.

## Taxonomy

| Code | When |
| --- | --- |
| `INVALID_SIGNATURE` | HMAC missing, invalid, or expired. Nothing is stored. |
| `MALFORMED_WEBHOOK` | Malformed signature header, invalid JSON, or adapter validation failure. |
| `UNSUPPORTED_EVENT` | Unknown provider or unknown synthetic event name. |
| `CONFLICTING_EVENT` | Same provider + external event id, different payload hash. Original row stays authoritative. |
| `INVALID_STATE_TRANSITION` | State machine / replay rejects the event (`REJECTED`, or replay `CONFLICT` with `IMPOSSIBLE_AFTER_ORDERING`). Transition is not forced. |
| `PROCESSING_FAILURE` | Temporary processing failure; a retry is scheduled. The event is kept. |
| `RETRY_EXHAUSTED` | The retry budget was consumed. The event is dead-lettered, not discarded. |
| `OUT_OF_ORDER_EVENT` | Event stored but delayed awaiting a prerequisite. Not a permanent failure. |
| `MISSING_EVENT` | Out-of-order delay whose **immediate** missing predecessor is unique in the published transition table. No timeout heuristic. |
| `DUPLICATE_EVENT` | Valid identical redelivery. No second payment transition and no second economic event. |

Identity-hash `CONFLICT` (store) is `CONFLICTING_EVENT`. Replay `CONFLICT` with `MATERIAL_CONFLICT` is also `CONFLICTING_EVENT`. Replay `CONFLICT` with `IMPOSSIBLE_AFTER_ORDERING` is `INVALID_STATE_TRANSITION` (domain, not payload-hash identity).

## Severity rules

Severity is `EXCEPTION_SEVERITY_BY_CODE`:

| Severity | Codes |
| --- | --- |
| `INFO` | `DUPLICATE_EVENT` |
| `WARNING` | `OUT_OF_ORDER_EVENT`, `MISSING_EVENT`, `UNSUPPORTED_EVENT` |
| `ERROR` | `INVALID_SIGNATURE`, `MALFORMED_WEBHOOK`, `CONFLICTING_EVENT`, `INVALID_STATE_TRANSITION`, `PROCESSING_FAILURE` |
| `CRITICAL` | `RETRY_EXHAUSTED` |

Examples from the product rules: duplicate webhook → INFO; out-of-order → WARNING; conflicting event → ERROR; retry exhausted → CRITICAL.

## Precedence

A single context may produce several **independent** exceptions. Detection does not keep only the “worst” one.

Display / processing order (`EXCEPTION_PRECEDENCE`):

1. `INVALID_SIGNATURE`
2. `MALFORMED_WEBHOOK`
3. `UNSUPPORTED_EVENT`
4. `CONFLICTING_EVENT`
5. `INVALID_STATE_TRANSITION`
6. `PROCESSING_FAILURE`
7. `RETRY_EXHAUSTED`
8. `OUT_OF_ORDER_EVENT`
9. `MISSING_EVENT`
10. `DUPLICATE_EVENT`

Same-code facts collapse to one draft. Different codes remain.

Example: a delayed capture yields `OUT_OF_ORDER_EVENT` and, when the table uniquely names `payment.authorized`, `MISSING_EVENT`. A later retry exhaustion of a different condition is a separate `RETRY_EXHAUSTED` row.

## Deduplication

Identity:

```
exceptionCode | webhookEventId | paymentId | correlationScope
```

- If `webhookEventId` is present, `correlationScope` is empty. Retries of the same stored event reuse the webhook id, so `PROCESSING_FAILURE` is one row per event, not one row per attempt.
- If nothing was persisted, identity uses `correlationId` so two unrelated unsigned requests do not collapse.

`RETRY_EXHAUSTED` is a different code from `PROCESSING_FAILURE`, so both may exist for one webhook. That is intentional: temporary failure then budget exhaustion are related but not the same incident class.

PostgreSQL enforces uniqueness on the identity key. There is no delete API.

## Lifecycle

| Status | Meaning |
| --- | --- |
| `OPEN` | Detected; default for every new row |
| `ACKNOWLEDGED` | Reserved for a future operator workflow |
| `RESOLVED` | Reserved for a future operator workflow |

Detection always creates `OPEN` records. This package does not auto-resolve when a later replay applies a previously delayed event. Historical detection stays. A future workflow may move status forward (`OPEN` → `ACKNOWLEDGED` → `RESOLVED`). Reverse transitions are not allowed.

No HTTP mutation for acknowledgement or resolution is exposed yet.

## Missing events

`MISSING_EVENT` is emitted only when:

1. An `OUT_OF_ORDER_EVENT` fact exists (`AWAITING_PREREQUISITE` or `OUT_OF_ORDER`)
2. `lookupTransition(current, delayedType)` is empty
3. The delayed type is eventually possible from the published table
4. Exactly one immediate enabling event type from the current state leads toward that delayed type

Created + early capture ⇒ missing `payment.authorized`. There is no clock and no “wait N minutes” rule.

## Relationship to audit

Classification lives here. Append-only audit lives in `@hookx/audit` / `@hookx/storage`.

When persistence inserts a **new** exception row, the application appends an audit event:

| Exception code | Audit type |
| --- | --- |
| `CONFLICTING_EVENT` | `WEBHOOK_CONFLICT_DETECTED` |
| `INVALID_STATE_TRANSITION` | `INVALID_TRANSITION_DETECTED` |
| `RETRY_EXHAUSTED` | `RETRY_EXHAUSTED` |
| all others | `EXCEPTION_DETECTED` |

Status changes append `EXCEPTION_STATUS_CHANGED`. Existing ingest/retry audit (`WEBHOOK_DUPLICATE`, `WEBHOOK_DELAYED`, `RETRY_DEAD_LETTERED`, …) is unchanged. Exception audit is additional evidence, not a second ledger.

Replay through `replayEvents` does not create exceptions or audit rows. Live ingest and the retry worker do.

## Security

Metadata uses `sanitizeAuditMetadata`:

- Keys matching secret / signature / password / authorization / credential / payload / token / cookie / rawBody are dropped
- Nested objects are dropped
- Strings longer than 128 characters are dropped

Do not put webhook secrets, HMAC signatures, credentials, or full payment payloads on an exception.
