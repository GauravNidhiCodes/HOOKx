# @hookx/investigation

Read-only AI investigation of **already classified** HOOKX exceptions.

This package explains a deterministic exception. It does not decide whether an exception exists, which code it receives, or what the payment state is.

```
Deterministic engine          This package
---------------------         --------------------------------
exception exists?             inspect structured evidence
exception code                explain what happened
payment state                 hypothesize contributing factors
event identity                recommend an advisory action
retry / audit history         state uncertainty
```

HOOKX is not an AI payment system. An LLM is an investigator, not the source of truth.

## Why AI cannot mutate financial state

Investigation output is commentary. It is stored as a separate advisory record. It is never applied as a payment command.

The investigator interface receives **structured evidence only**. It does not receive:

- database writers
- payment mutation methods
- payment-provider credentials or APIs
- arbitrary HTTP clients for PSPs
- shell execution
- unrestricted tools

A recommendation such as `RETRY_PROCESSING` is not a job to run. `executable` is always `false`. The model is forbidden from recommending capture, refund, settle, charge, or payout of money. Those strings are rejected at validation even if they appear in prose.

Financial correctness stays on:

```
Webhook → verification → normalization → idempotency → state processing
```

Investigation is a secondary, on-demand capability. Ingest does not call an investigator. If an LLM is down, webhooks still persist and payments still transition.

## Deterministic vs AI responsibilities

| Concern | Owner |
| --- | --- |
| Exception existence and code | `@hookx/exceptions` |
| Payment state | `@hookx/state-machine` |
| Event identity / idempotency | `@hookx/storage` + webhook identity |
| Retry / dead-letter | retry worker |
| Audit history | append-only `audit_events` |
| Explanation, likely cause, advisory next step | `Investigator` |

The model must not classify exceptions, mark money reconciled, create or delete financial records, or bypass policies.

## Investigator interface

The rest of HOOKX depends on `Investigator`, not on an LLM SDK.

```
investigate(context: InvestigationContext) → Promise<InvestigationResult>
```

Metadata on every implementation:

- `implementation` — `stub`, `openai`, `unavailable`, …
- `modelId` — provider model string, or `null` for local implementations
- `promptVersion` — currently `investigation-v1`

Callers construct context at the application boundary and pass that object in. They do not pass a store.

### Implementations

| Class | When |
| --- | --- |
| `StubInvestigator` | Default. Deterministic, no network, suitable for tests and local runs without an API key. |
| `OpenAIInvestigator` | Isolated HTTP adapter (OpenAI-compatible Chat Completions). Optional. |
| `UnavailableInvestigator` | Credentials missing or the provider failed. Returns a controlled LOW-confidence result. |

`createInvestigatorFromEnv(env)`:

- `HOOKX_INVESTIGATION_PROVIDER` unset or `stub` → `StubInvestigator`
- `openai` without `HOOKX_OPENAI_API_KEY` → `UnavailableInvestigator`
- `openai` with a key → `OpenAIInvestigator`

The application must build and run with no AI API key. Default is the stub.

A future `OtherProviderInvestigator` can implement the same interface without changing ingest or persistence.

## Investigation context

`InvestigationContext` is a minimized DTO:

- exception (code, severity, status, ids, sanitized metadata)
- payment projection (state, amount as a **string** of minor units, currency)
- related webhook rows (ids, types, statuses, amounts as strings — **not** payload hashes)
- retry rows for those webhooks
- audit rows (type, states, reason, actor — **not** raw metadata blobs)
- applicable deterministic rule statements
- investigation timestamp, correlation id, provider via the exception/payment

It is not a database dump. Secrets, HMAC signatures, API keys, raw provider payloads, and unrelated rows are out of scope.

The application builder caps related webhooks and audit rows so a busy payment cannot flood the model.

## Evidence model

Every conclusion the UI later shows must point at a concrete stored object:

```
Evidence {
  sourceType: WEBHOOK_EVENT | EXCEPTION | AUDIT_EVENT | STATE_TRANSITION | RETRY_ATTEMPT
  sourceId:   uuid of that object
  fact:       statement about that object
}
```

`STATE_TRANSITION` uses the `auditEventId` of a `PAYMENT_STATE_CHANGED` row. `RETRY_ATTEMPT` uses the retry row id.

Evidence `sourceId` values that are not in the supplied context are rejected. Parsing JSON is not acceptance.

## Structured output

`InvestigationResult`:

| Field | Role |
| --- | --- |
| `summary` | Short investigation narrative |
| `facts` | Confirmed from supplied evidence only |
| `evidence` | Structured citations |
| `likelyCause` | Hypothesis. Not a confirmed fact. |
| `recommendedAction` | Advisory `{ code, detail, executable: false }` |
| `confidence` | `LOW` / `MEDIUM` / `HIGH` for the **explanation**, not that money is safe |
| `limitations` | What the investigator did not see or cannot claim |

`createInvestigationResult` schema-checks enums, lengths, printable text, recommendation codes, and forbidden financial verbs. `validateInvestigationResult` then binds evidence ids and scans prose for identifiers (UUIDs, `SYNTHETIC:…` ids, ISO timestamps) that were not in the context.

Rejected safely (not trusted because it parsed):

- malformed JSON
- missing required fields
- unsupported confidence (`87%`, etc.)
- unknown recommendation codes
- evidence pointing at an id that was not supplied
- hallucinated event ids / timestamps / synthetic identifiers
- “capture/refund/settle payment” style instructions

On rejection the HTTP layer persists an `UnavailableInvestigator` result instead of storing fabricated citations.

## Fact vs hypothesis

Facts belong in `facts` and `evidence`. Hypotheses belong in `likelyCause`.

Example:

- Fact: a capture webhook was stored while payment state was still `CREATED`.
- Hypothesis: the provider may have delivered events out of order.

Do not present `likelyCause` as a confirmed ledger fact. The stub implementation uses “may have” only in `likelyCause`.

## Prompt and security

Privileged instructions live in `INVESTIGATION_SYSTEM_PROMPT` (`promptVersion` `investigation-v1`). That string tells the model it is investigating a webhook exception, it is not authorized to modify financial state, it may use only supplied evidence, it must not invent facts, it must distinguish facts from hypotheses, and recommendations are advisory.

Untrusted payment data is sent in a **separate user message** labeled `UNTRUSTED INVESTIGATION EVIDENCE`. Provider payload text (and any instruction-like strings that leaked into sanitized metadata) must not be concatenated into the system prompt.

Treat model output as untrusted. Prompt-injected webhook content cannot override exception codes, payment state, or HOOKX policies because those are not taken from the model.

The OpenAI adapter:

- sends `response_format: json_object`
- sets `temperature: 0`
- does not register tools or function calls
- does not call payment-provider APIs
- reads the API key only from the process environment
- uses `HOOKX_OPENAI_BASE_URL` when set (server-side only)

API keys never go to the browser. `.env.example` contains placeholders only.

## Data minimization

Send only what the investigator needs:

- identifiers, states, exception codes, amounts as decimal strings, timestamps
- small sanitized exception metadata (same sanitizer as audit)

Do not send:

- secrets, signatures, API keys, cookies, tokens
- raw webhook bodies or `payloadHash`
- internal database credentials
- unrelated payments or the entire event log

Amounts are strings so JSON cannot silently coerce `bigint`.

## Persistence

Investigation rows are **advisory** and **append-only**. They live in `investigations`, not on the exception row.

A new investigation does not overwrite:

- exception code, severity, status, identity
- payment state or amount
- webhook payload columns
- audit history

Stored metadata for debugging (not bit-exact LLM reproducibility):

- investigation id
- exception id
- investigator implementation
- model identifier (if any)
- prompt version
- result JSON
- created timestamp
- correlation id

Do not claim that an LLM run is exactly reproducible.

## Failure behavior

| Condition | Investigation | Webhook ingest |
| --- | --- | --- |
| No API key / stub provider | Stub (or unavailable if OpenAI was requested) | Unaffected |
| Provider HTTP/network error | Controlled unavailable result | Unaffected |
| Malformed or hallucinated model output | Rejected; unavailable result persisted | Unaffected |
| Investigator omitted from the API process | POST returns a controlled unavailable investigation | Unaffected |

Never fail `POST /webhooks/:provider` because an LLM is unavailable. That path must not import or await an investigator.

## HTTP (application)

Defined on `@hookx/api`, not in this package:

- `POST /exceptions/:id/investigate` — load exception, build context, investigate, validate, persist, return
- `GET /exceptions/:id/investigation` — latest advisory record

Neither route mutates payment state or exception classification.

## Tests

Package tests cover the stub, schema validation, malformed JSON, invalid and hallucinated evidence, confidence and recommendation checks, fact/hypothesis separation, missing API key, provider unavailability, OpenAI message isolation, and the read-only `Investigator` / `InvestigationContext` types.

Application and storage tests cover persistence, unchanged exception/payment rows, conflict-path end-to-end investigation, and ingest without an investigator.
