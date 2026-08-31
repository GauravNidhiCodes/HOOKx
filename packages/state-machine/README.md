# @hookx/state-machine

Deterministic payment state machine for HOOKX.

`processEvent` is a pure function:

```
currentPayment + event + processingHistory → TransitionResult
```

The same inputs always produce the same result. This package does not read the clock, the filesystem, the network, a database, or a provider SDK.

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

## Invalid transitions

Every unspecified pair is `REJECTED` with `reason: "INVALID_TRANSITION"`. Examples:

- `CAPTURED` + `payment.authorized`
- `REFUNDED` + `payment.captured`
- `FAILED` + `payment.captured`
- `CREATED` + `payment.captured`
- _(none)_ + `payment.authorized`

If `currentPayment` exists and `event.paymentId` differs, the result is `REJECTED` with `reason: "PAYMENT_ID_MISMATCH"`.

Rejected results do not describe a new state.

## Duplicate behavior

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

## Conflict behavior

If identity matches a processed event **and** any material field differs, the result is `CONFLICT`.

The original history record is not overwritten. `existing` and `incoming` material snapshots are returned for the caller to record.

`payloadHash` is a caller-supplied content fingerprint used in that comparison. It is not a substitute for webhook identity, and this package does not compute a cryptographic hash.

## Ordering preparation

Each payment snapshot stores `lastOccurredAt` from the event's `occurredAt`. That timestamp is an input. `Date.now()` / `new Date()` are not used as the financial occurrence time.

If `event.occurredAt` is strictly earlier than `currentPayment.lastOccurredAt`, the result is `DELAYED` / `OUT_OF_ORDER`. The transition is not applied.

Buffering, replay, and recovery of delayed events are **not** implemented here.

## Determinism guarantees

- Result depends only on `currentPayment`, the normalized event, and `processingHistory`.
- Instant comparison uses the event's UTC `occurredAt` string, not the system clock.
- Money values remain `bigint`. This package does not convert `bigint` to `number` or use floating-point arithmetic on amounts.
- Events are treated as immutable. Results and payment snapshots are frozen objects.

## API

```ts
processEvent(
  currentPayment,
  event,
  processingHistory,
): TransitionResult
```

`TransitionResult.status` is one of:

`ACCEPTED` · `REJECTED` · `IGNORED_DUPLICATE` · `DELAYED` · `CONFLICT`
