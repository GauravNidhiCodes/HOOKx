# @hookx/state-machine

Deterministic payment state machine for HOOKX, plus the ordering/replay coordinator that sits **above** it.

```
Stored Events
     ↓
Ordering / Replay Coordinator   (this package: replayEvents)
     ↓
Deterministic State Machine     (this package: processEvent)
     ↓
New Payment State
```

`processEvent` remains the source of truth for whether a transition is legal. Ordering logic does **not** rewrite the machine to guess a future state.

## Supported states

`CREATED` · `AUTHORIZED` · `CAPTURED` · `FAILED` · `REFUNDED`

`FAILED` and `REFUNDED` are terminal.

## Supported events

Normalized webhook events only:

- `payment.created`
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `refund.created`

Provider-specific payloads are not part of this layer.

## Valid transitions

```
                    payment.failed
                         │
                         ▼
(none) --payment.created--> CREATED --payment.authorized--> AUTHORIZED --payment.captured--> CAPTURED --refund.created--> REFUNDED
                         │                                      │
                         │ payment.failed                       │ payment.failed
                         ▼                                      ▼
                      FAILED                                 FAILED
```

| From | Event | To |
| --- | --- | --- |
| _(none)_ | `payment.created` | `CREATED` |
| `CREATED` | `payment.authorized` | `AUTHORIZED` |
| `CREATED` | `payment.failed` | `FAILED` |
| `AUTHORIZED` | `payment.captured` | `CAPTURED` |
| `AUTHORIZED` | `payment.failed` | `FAILED` |
| `CAPTURED` | `refund.created` | `REFUNDED` |

On `ACCEPTED`, the result includes a **new** payment snapshot. The previous payment object is not mutated.

Money on an existing payment is copied through unchanged (`bigint` minor units + ISO currency). The creating event supplies the initial amount.

## Invalid transitions (`processEvent`)

Every unspecified pair is `REJECTED` with `reason: "INVALID_TRANSITION"`. Examples:

- `CAPTURED` + `payment.authorized`
- `REFUNDED` + `payment.captured`
- `FAILED` + `payment.captured`
- `CREATED` + `payment.captured`
- _(none)_ + `payment.authorized`

`CREATED` + `payment.captured` stays illegal inside the machine. The coordinator maps that outcome to `DELAYED` when authorization is still possible (see below). It does not teach the machine that capture is valid from `CREATED`.

If `currentPayment` exists and `event.paymentId` differs, the result is `REJECTED` with `reason: "PAYMENT_ID_MISMATCH"`.

Rejected results do not describe a new state.

## Duplicate behavior (`processEvent`)

Webhook identity is `provider + externalEventId`.

If that identity is already in `processingHistory` **and** the material contents match, the result is `IGNORED_DUPLICATE`. No second economic transition is described.

Material contents are:

- `paymentId`
- `eventType`
- `occurredAt`
- `amountMinor`
- `currency`
- `payloadHash`

`receivedAt` is delivery metadata and is not part of the material comparison. Identity is never derived from `payloadHash`.

The caller appends to history after an `ACCEPTED` result (`withProcessedEvent`). The machine itself does not mutate history.

## Conflict behavior (`processEvent`)

If identity matches a processed event **and** any material field differs, the result is `CONFLICT`.

The original history record is not overwritten. `existing` and `incoming` material snapshots are returned for the caller to record.

## Ordering strategy

Primary order is the provider occurrence timestamp `occurredAt`.

Not used as a substitute for occurrence time:

- webhook arrival time (`receivedAt`)
- database insertion time (`created_at`)
- `Date.now()` / `new Date()`
- random or input-array order

`compareInstant` compares UTC instants (fractional seconds padded). `Date.now()` is never the financial occurrence time.

Timestamps do **not** override domain rules. After events are sorted, each one is still offered to `processEvent`. An earlier `occurredAt` cannot force `CREATED → CAPTURED`.

## Timestamp semantics

`occurredAt` is an input on the normalized event: an ISO-8601 UTC instant ending in `Z`. It is the provider's statement of when the domain event happened.

`receivedAt` is when HOOKX observed the webhook. It is ignored by ordering, replay, and material comparison.

`lastOccurredAt` on a payment snapshot is copied from the last **accepted** event's `occurredAt`. Inside `processEvent`, an event whose `occurredAt` is strictly earlier than `lastOccurredAt` is `DELAYED` / `OUT_OF_ORDER` and is not applied. Sorted replay makes that path rare; the coordinator still honors it.

## Deterministic tie-breaking

Two events may share the same `occurredAt`. Order is then the webhook identity key:

```
{"provider":"<provider>","externalEventId":"<externalEventId>"}
```

That string is compared with ordinary UTF-16 `<` / `>` (the same representation `eventIdentityKey` returns). Provider is compared before external event id because JSON key order is fixed.

This is stable across process restarts and independent of:

- input array order
- `receivedAt`
- database `id` / `created_at`

If two entries in the same input list are the same identity (duplicate copies), they compare equal on time and identity. `orderWebhookEvents` then uses original input index only so `Array.prototype.sort` stability is not required. Duplicate copies do not change the resulting payment state.

## Delayed events

Coordinator processing outcomes:

| Decision | Meaning |
| --- | --- |
| `ACCEPTED` | `processEvent` accepted; payment snapshot advanced |
| `DUPLICATE` | Same identity already applied with matching material |
| `DELAYED` | Event is stored/known but not applied yet |
| `CONFLICT` | Impossible after ordering, or material identity conflict — investigate |
| `REJECTED` | Hard reject (currently payment id mismatch) |

A legal event that arrived before its prerequisite is `DELAYED` with reason `AWAITING_PREREQUISITE`, not a permanent invalid transition.

Example:

1. `payment.created` → `CREATED`
2. `payment.captured` while `AUTHORIZED` is still required

Result: payment stays `CREATED`; capture is `DELAYED`. The capture event is not discarded.

`DELAYED` is a processing decision. The coordinator never deletes or overwrites the event. Persistence is the event store's job; replay is a projection over that log.

Internally, `CREATED` + `payment.captured` is still `REJECTED` / `INVALID_TRANSITION` from the machine. The coordinator asks whether any **reachable** future state (following the published table, without applying it) could accept that event type. If yes → `DELAYED`. If no → `CONFLICT` / `IMPOSSIBLE_AFTER_ORDERING`.

Reachability is not a hidden transition. It only classifies “wait” versus “investigate”.

## Replay behavior

`replayEvents(events, scope?)` is a pure function:

```
events → ReplayResult
```

It has no database access, no network, no system clock, and no randomness. Same scoped events → same result.

Algorithm:

1. Keep events matching `provider + paymentId` (scope, or the first event).
2. Sort with `orderWebhookEvents`.
3. Repeatedly offer unsettled events to `processEvent` with the history of **accepted** events only.
4. On `ACCEPTED`, apply the new snapshot and record the identity in history.
5. Stop when a pass makes no further `ACCEPTED` progress.
6. Leftover events that are still eventually possible remain `DELAYED`.
7. Leftover events that are not eventually possible become `CONFLICT`.

Late arrival example:

- `created` then `captured` → `CREATED`, capture `DELAYED`
- `authorized` stored later
- replay of the full history → `CREATED` → `AUTHORIZED` → `CAPTURED`

No manual state edit. Delayed events are not removed from the log; they become applicable once the prerequisite is present.

Database loading belongs in `processPaymentEvents` (`@hookx/storage`). That service retrieves rows, then calls `replayEvents`. It does not insert, delete, or overwrite events.

## Replay idempotency

Running `replayEvents` twice on the same event list produces the identical `ReplayResult` (payment snapshot, decisions, delayed set, investigation flag).

Replay does not:

- duplicate stored events
- append audit rows (this layer has no audit writer)
- mutate historical event objects
- allocate random ids
- read the current time

Accepted identities are tracked in an in-memory processing history for that replay only.

## Conflict behavior (coordinator)

If, after deterministic ordering and fixed-point replay, `processEvent` still cannot accept an event and no reachable state could accept that event type, the decision is `CONFLICT` with `reason: "IMPOSSIBLE_AFTER_ORDERING"`.

`ReplayResult.requiresInvestigation` is `true` when any decision is `CONFLICT`.

The coordinator does **not** force the payment into a nearby valid state. Example: `created` + `failed` + `captured` ends in `FAILED`. Capture is a conflict, not a silent `CAPTURED`.

Material identity conflicts from `processEvent` surface as `CONFLICT` / `MATERIAL_CONFLICT`.

## Determinism guarantees

- `processEvent` depends only on `currentPayment`, the normalized event, and `processingHistory`.
- `replayEvents` depends only on the scoped event list (and optional scope).
- Instant comparison uses the event's UTC `occurredAt` string, not the system clock.
- Tie-breaks use webhook identity, not insertion order.
- Money values remain `bigint`.
- Events are treated as immutable. Results, decisions, and payment snapshots are frozen objects.

## Observability records

Each replay decision includes:

- `paymentId`
- `provider`
- `eventId` (provider `externalEventId`)
- `previousState`
- `resultingState`
- `decision`
- `reason`

No logging framework is attached here.

## API

```ts
processEvent(currentPayment, event, processingHistory): TransitionResult

replayEvents(events, scope?): ReplayResult

orderWebhookEvents(events): NormalizedWebhookEvent[]
```

`TransitionResult.status` is one of:

`ACCEPTED` · `REJECTED` · `IGNORED_DUPLICATE` · `DELAYED` · `CONFLICT`

`ReplayDecision.decision` is one of:

`ACCEPTED` · `DUPLICATE` · `DELAYED` · `CONFLICT` · `REJECTED`
