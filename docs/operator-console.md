# Operator console

The HOOKX operator console is a read-only investigation workspace. It answers “what happened to this payment?” from persisted API data. It does not own the state machine, invent metrics, or mutate payment state.

All simulator-generated rows are labelled **SYNTHETIC**. The console never describes them as live, production, or real customer payments.

## Navigation

Primary destinations (header order: Overview, Demo, Incidents, Failure Lab):

| Path | Purpose |
| --- | --- |
| `/` | Overview: HOOKX heading, what it solves, **RUN GOLDEN DEMO**, architecture, persisted counts or **NO DATA** |
| `/demo` | Golden Demo: synthetic fail-once through `POST /webhooks/SYNTHETIC` |
| `/incidents` | Exception-backed incident list (no fabricated KPIs) |
| `/incidents/:id` | Incident chronology, deterministic result, optional AI investigation |
| `/failure-lab` | Synthetic Failure Lab (real ingest pipeline; no Razorpay calls) |

Linked investigation routes (not primary nav):

| Path | Purpose |
| --- | --- |
| `/exceptions` | Deterministic exception queue |
| `/exceptions/:id` | Exception investigation |
| `/payments` | Persisted payment index |
| `/payments/:paymentId` | Payment workspace |
| `/events` | Persisted webhook event index |
| `/events/:eventId` | Event inspector (`:eventId` is the stored webhook id) |

There is no analytics dashboard and no extra sidebar of invented sections.

## Payment investigation workflow

Open `/payments/:paymentId`. The page loads the durable payment projection and, in the same workspace:

1. **PAYMENT** — id, provider, current state, created/updated timestamps, synthetic classification. Amount is shown only as backend minor units plus currency. The UI never converts money to floating-point numbers.
2. **STATE HISTORY** — `PAYMENT_STATE_CHANGED` rows from audit, in the order the API returns (append sequence). Event, time, previous → new, reason. React does not re-run `processEvent`. When several rows share a timestamp, UUID sort is not used.
3. **EVENTS** — stored webhooks for the payment. `occurredAt` is when the provider says the event happened. `receivedAt` is when HOOKX accepted the delivery. That gap is how out-of-order arrival is demonstrated. Filter by event type, processing status, or external event id.
4. **REPLAY** — shown when delivery order (`receivedAt`) differs from logical order (`occurredAt`), or when audit recorded `WEBHOOK_DELAYED`. Original delivery order vs resolved logical order vs final projected state. This is the deterministic replay result. It is not an AI product.
5. **EXCEPTIONS** — linked rows to `/exceptions/:id`.
6. **RETRY HISTORY** — attempt number, time, result, failure classification, and next retry when audit recorded retry lifecycle events. Stack traces are not shown.
7. **AUDIT HISTORY** — append-only. No edit or delete controls.
8. **INVESTIGATION** — if an exception on the payment already has an advisory investigation: summary, evidence, likely cause, recommended action, confidence, limitations.

Copy buttons exist for payment, event, exception, and correlation identifiers. Confirmation is the text “Copied”. There are no colored toasts.

## Event inspection

`/events/:eventId` shows the stored webhook (id, provider, type, external id, occurred/received times, processing status, payment id) and a **PROCESSING** summary derived from stored status plus audit:

- verification: `PASSED` (unverified bytes are never stored)
- normalization: `NORMALIZED`
- idempotency: `STORED` / `DUPLICATE` / `CONFLICT` from receipt audit
- decision: processing status, or `DELAYED` when `WEBHOOK_DELAYED` exists

**SANITIZED PAYLOAD** is a collapsible notice. Raw webhook bodies, secrets, API keys, signatures, and credentials are not stored and are not rendered. There is no unsafe raw-payload viewer.

The event links back to `/payments/:paymentId`.

## Replay visualization

Replay compares two orderings of the **same stored events**:

- original delivery order = `WEBHOOK_RECEIVED` rows in the audit list order returned by the API (append sequence). When those rows are missing, the console falls back to `receivedAt`
- resolved logical order = sort by `occurredAt`

Simulator deliveries often share one `receivedAt`. Audit sequence is what shows created → captured → authorized as originally delivered.

Final state is the payment projection. The banner states that this is a deterministic replay result, not AI output. The console does not re-run `processEvent`.

## Exception relationships

From a payment, each exception links to `/exceptions/:id` (code, severity, status, detected time).

From an exception, the payment id links to `/payments/:paymentId` and the webhook id links to `/events/:eventId`.

That is the investigation loop: payment → events → exceptions → back to payment.

## Incidents

`/incidents` lists persisted exceptions as incidents. Successful webhooks do not appear. `/incidents/:id` loads one backend timeline (`GET /incidents/:id/timeline`) instead of reconstructing chronology from many client calls. Clock order is delivery/recording time; event time and received time are both shown when stored.

**INVESTIGATE** requests `POST /incidents/:id/investigate`. The page separates **DETERMINISTIC SYSTEM RESULT** from **AI-GENERATED INVESTIGATION**. Banners **AI-GENERATED INVESTIGATION**, **READ-ONLY**, **NO FINANCIAL STATE CHANGES**, and **ADVISORY — DETERMINISTIC SYSTEM REMAINS AUTHORITATIVE** are visible. This is not a chatbot.

See `docs/observability.md` and `docs/ai-investigator.md`.

## Failure Lab

`/failure-lab` runs synthetic failure scenarios through `POST /webhooks/SYNTHETIC` (and `POST /webhooks/razorpay` for Razorpay-shaped scenarios). Results, logs, and incident links are taken from that execution. Reset deletes only `SYNTHETIC:pay:lab-*` rows.

`/demo` is the Golden Demo: the same pipeline, one polished fail-once synthetic run. See `docs/golden-demo.md`.

The Failure Lab never sends real payment requests. See `docs/failure-lab.md`.

## AI investigation boundary

Investigation is advisory. The console displays:

`ADVISORY — DETERMINISTIC SYSTEM REMAINS AUTHORITATIVE`

Evidence items link to the underlying exception, incident, or webhook when the source type allows it. Recommended actions are labelled **NOT EXECUTABLE**. **INVESTIGATE** does not capture, refund, or change payment state. See `docs/ai-investigator.md`.

**AI does not determine financial state.**

## Synthetic data

Rows whose provider or payment id is `SYNTHETIC` / `SYNTHETIC:…` show **SYNTHETIC**. They are simulator traffic through the real ingest pipeline. They are not live provider events.

## Accessibility

Copy actions are labelled buttons. Primary navigation and tables are keyboard-reachable. Focus uses a `#000000` outline on `#FFFFFF`. Collapsible payload uses native `details`/`summary`. Nothing is hover-only.
