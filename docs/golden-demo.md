# Golden Demo

The Golden Demo is a single operator path that runs a **synthetic** Razorpay-shaped webhook through the **existing** HOOKX pipeline. It is not a second processing engine and it does not invent results in the browser.

Purpose: show a reviewer, in a few minutes, how HOOKX verifies, stores, fails, retries, recovers, audits, and explains a webhook without applying a second economic effect.

## Exact flow

Operator console `/demo` → **RUN DEMO** → `POST /demo/run` → Failure Lab scenario `GOLDEN_DEMO`:

1. Unique `demoRunId` (UUID). Payment id `SYNTHETIC:pay:lab-{demoRunId}`. Event id `SYNTHETIC:evt:lab-{demoRunId}-1`. Correlation id `demo-{demoRunId}` (`X-Request-Id` on the first ingest).
2. A Razorpay `payment.authorized` JSON envelope is signed with `RAZORPAY_WEBHOOK_SECRET`.
3. `POST /webhooks/razorpay` — raw body, HMAC verify, adapter normalize, persist.
4. Lab-only `FAIL_ONCE` injection throws `RetryableProcessingError` on the first process of that lab payment. Ingest returns a processing error. The event row remains. A retry is scheduled.
5. The lab retry worker drains due retries (clock advanced to `nextAttemptAt`; no cosmetic sleep). The second process succeeds. Event processing status is `PROCESSED`.
6. The same signed identity is posted again. Ingest classifies **duplicate**. One stored event.
7. The execution report is assembled from stored webhooks, retries, exceptions, audit, and the incident timeline.
8. The operator may open **VIEW INCIDENT** / **VIEW TIMELINE** and **INVESTIGATE INCIDENT** (`POST /incidents/:id/investigate`). Investigation is read-only.

The UI marks lifecycle steps **only** from that report (and from a successful investigate call for step 08). It does not use `setTimeout` to fake progress.

## Backend path

```
POST /demo/run
  → createLabProcessFn(FAIL_ONCE)
  → POST /webhooks/razorpay   (signed synthetic envelope)
  → signature verification
  → Razorpay adapter normalize
  → idempotent persist
  → processPaymentEvents (injected fail-once, lab ids only)
  → retry ticks
  → identical redelivery (duplicate)
  → composeFailureLabReport from PostgreSQL (or the API process store)
```

`GET /demo` describes the demonstration. `GET /demo/runs` and `GET /demo/runs/:id` return in-memory reports for this API process (same map as Failure Lab). Failure Lab scenario 08 `GOLDEN_DEMO` is the same runner.

## Synthetic nature

Nothing is sent to Razorpay. Data source is SYNTHETIC. Provider on the stored event is `razorpay` because the adapter path was used. Payment ids stay on the Failure Lab prefix so scoped reset cannot touch simulator or live-shaped ids.

## Failure injection

`FAIL_ONCE` / `ALWAYS_FAIL` run only when the payment id is `SYNTHETIC:pay:lab-*` **and** the provider is `SYNTHETIC` or `razorpay`. Live-shaped ids (`pay_…`) and simulator ids (`SYNTHETIC:pay:sim-*`) are never injected. The wrapper is attached only to the inner app for that lab/demo run. Production `processPaymentEvents` is unchanged. Clients cannot pass an injection function.

## Retry behavior

Retry uses the process retry policy. The Golden Demo uses `FAIL_ONCE`, so the first process fails and a later attempt should `SUCCEEDED` when the policy allows it. Attempt timestamps come from stored retry / audit rows.

If retries never succeed (`ALWAYS_FAIL` / dead-letter), the report status is `DEAD_LETTERED` and the UI shows **RETRY EXHAUSTED**. It does not display recovery. That path is covered by tests; it is not the primary **RUN DEMO** button.

## Recovery

Recovery is the stored event reaching `PROCESSED` after retry `SUCCEEDED`. Razorpay does not send `payment.created`. HOOKX does not invent that event, so a Razorpay-only authorized stream does **not** project a payment row. The demo shows `PAYMENT none` when that is the stored state. It does not print a generic SUCCESS banner in place of those fields.

## Safety invariant

**NO DUPLICATE ECONOMIC EFFECT** is shown only when the report has exactly one stored event and zero `PAYMENT_STATE_CHANGED` audit rows for that payment. Those counts are read from the store after the run.

## Audit

`auditCount` and the incident timeline are persisted application audit, not a UI log. **AUDIT TRAIL AVAILABLE** appears when `auditCount > 0`.

## Incident and timeline

If processing created an exception, the report includes `incidentId` and links to `/incidents/:id`. The demo timeline is `report.log`, which is loaded from the same incident timeline composition as the operator incident page. If a given run does not create an incident, the UI does not fabricate one.

## AI investigation

**INVESTIGATE INCIDENT** calls the existing investigator. Labels: **AI-GENERATED INVESTIGATION**, **READ-ONLY**, **NO FINANCIAL STATE CHANGES**. Investigation does not cause retry recovery. The stub (default) or optional OpenAI path both consume stored evidence. Recommended actions are not executable.

## Limitations

- Requires `HOOKX_SYNTHETIC_WEBHOOK_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (placeholder is fine). Missing Razorpay secret → `503 RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE` / **DEMO FAILED**.
- In-memory run history is per API process. Database rows remain until Failure Lab scoped reset.
- **NEW DEMO RUN** starts a new id. It does not delete previous synthetic rows.
- Not a live Razorpay connection, not production traffic, not a second queue or database.
- Default investigator is a stub unless `HOOKX_INVESTIGATION_PROVIDER` is configured for a model.

## Run HOOKX locally

Requires Node.js 22+, pnpm 11, PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env
```

Set at least:

```
HOOKX_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx
HOOKX_SYNTHETIC_WEBHOOK_SECRET=dev-only-synthetic-webhook-secret
RAZORPAY_WEBHOOK_SECRET=dev-only-razorpay-webhook-secret
```

`RAZORPAY_WEBHOOK_SECRET` may be any local placeholder. It is not a Razorpay dashboard credential requirement for this demo.

```bash
pnpm --filter @hookx/storage db:migrate
pnpm dev
```

- API: `http://127.0.0.1:8787`
- Console: `http://127.0.0.1:5173/demo`

Click **RUN DEMO**. Then **VIEW INCIDENT**, **VIEW TIMELINE**, **INVESTIGATE INCIDENT**. `HOOKX_INVESTIGATION_PROVIDER` may stay `stub`.

Automated equivalent: `apps/api/src/demo/golden.e2e.test.ts` (PostgreSQL). Exhaustion negative path: `apps/api/src/demo/exhaustion.e2e.test.ts`.
