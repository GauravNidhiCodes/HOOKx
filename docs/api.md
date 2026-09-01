# HTTP API

Implemented routes on `apps/api` (`createApp` in `apps/api/src/app.ts`). The process listens on `http://127.0.0.1:8787` by default.

The operator console (`http://127.0.0.1:5173`) proxies JSON calls for `/webhooks`, `/payments`, `/exceptions`, `/incidents`, `/retries`, `/dead-letters`, `/audit`, `/metrics`, `/health`, `/failure-lab`, and `/demo`. HTML navigations to those paths still serve the SPA.

There is no OpenAPI UI. `GET /` returns a JSON service descriptor, not this document.

Unauthenticated. Local operator workspace. Error bodies use stable `code` values; stack traces are not returned. See [error-codes.md](error-codes.md).

---

## Service

### `GET /`

Purpose: service descriptor.

Request: none.

Response `200`: JSON with `service`, `product`, `fullName`, `status: "ok"`, and path hints.

### `GET /health`

Purpose: process liveness.

Response `200`: `{ "status": "ok" }`.

### `GET /ready`

Purpose: dependency ping (PostgreSQL when wired).

Response `200`: `{ "status": "ready" }`.

Error: `503` `{ "status": "not_configured", "code": "READINESS_UNAVAILABLE" }` if no ping; `503` `{ "status": "unavailable", "code": "DEPENDENCY_UNAVAILABLE" }` if ping throws.

### `GET /metrics/summary`

Purpose: persisted counts for the operator Overview. Not an SLA.

Response `200`: `{ "asOf", "persisted": { "source": "database", "webhookEvents", "exceptions?", "retries", "deadLetters", "auditByType" }, "runtime?" }`.

---

## Ingest

### `POST /webhooks/:provider`

Purpose: verified ingest. `:provider` is `SYNTHETIC` or `razorpay`.

Request:

- Header `Content-Type: application/json` (charset allowed).
- Raw JSON body (HMAC is over these bytes; do not re-serialize).
- `X-Request-Id` optional (becomes `requestId`).
- `SYNTHETIC`: header `X-Hookx-Signature` (`t=<unix>,v1=<hex>`), secret `HOOKX_SYNTHETIC_WEBHOOK_SECRET`.
- `razorpay`: header `X-Razorpay-Signature` (HMAC-SHA256 hex of the raw body), `x-razorpay-event-id`, secret `RAZORPAY_WEBHOOK_SECRET`.

Response (success):

| HTTP | Body `status` | Meaning |
| --- | --- | --- |
| 200 | `accepted` | New identity stored; processing succeeded or was not retry-scheduled |
| 200 | `duplicate` | Same identity, same payload hash; no second economic transition |

Body always includes `requestId`. Secrets and signature values are never returned.

Error:

| HTTP | `code` (typical) | Persist event |
| --- | --- | --- |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | No |
| 413 | `PAYLOAD_TOO_LARGE` (256 KiB) | No |
| 404 | `UNSUPPORTED_PROVIDER` | No |
| 401 | `INVALID_SIGNATURE`, `MISSING_SIGNATURE`, `EXPIRED_SIGNATURE` | No |
| 400 | `MALFORMED_SIGNATURE` | No |
| 400 | `INVALID_PAYLOAD`, `UNSUPPORTED_EVENT`, `MISSING_EXTERNAL_ID`, `MISSING_PAYMENT_ID`, `INVALID_AMOUNT`, `INVALID_CURRENCY`, … | No |
| 409 | `CONFLICT` | Original row kept |
| 500 | `TEMPORARY_PROCESSING_FAILURE` | Event kept; retry may be scheduled |
| 500 | `INTERNAL_ERROR` | Uncaught handler |

---

## Webhook reads

### `GET /webhooks`

Purpose: list stored events.

Query: `q`, `eventType`, `processingStatus`, `paymentId`, `provider`.

Error `400`: `INVALID_EVENT_TYPE`, `INVALID_PROCESSING_STATUS`, `INVALID_PAYMENT_ID`, `INVALID_PROVIDER`.

Response `200`: `{ "webhooks": [ … ] }` (public fields; no raw body, no signature).

### `GET /webhooks/:webhookEventId`

Purpose: one stored event plus processing summary from audit.

Error `404`: `WEBHOOK_NOT_FOUND`.

### `GET /webhooks/:webhookEventId/audit`

Purpose: audit rows for that webhook.

Response `200`: `{ "audit": [ … ] }` (metadata sanitized).

---

## Payments

### `GET /payments`

Query: `q`, `provider`, `state`.

Error `400`: `INVALID_PROVIDER`, `INVALID_PAYMENT_STATE`. `404`: `PAYMENTS_UNAVAILABLE` if the payment store is not wired.

### `GET /payments/:paymentId`

Error `400`: `INVALID_PAYMENT_ID`. `404`: `PAYMENT_NOT_FOUND`.

### `GET /payments/:paymentId/webhooks`

Error `400`: `INVALID_PAYMENT_ID` / `INVALID_PROVIDER`. `404`: `PAYMENT_NOT_FOUND`.

### `GET /payments/:paymentId/audit`

Error `400`: `INVALID_PAYMENT_ID`.

### `GET /payments/:paymentId/exceptions`

Error `400`: `INVALID_PAYMENT_ID`.

---

## Retries and dead letters

### `GET /retries`

Response `200`: `{ "retries": [ … ] }` active retry rows.

### `GET /retries/:webhookEventId`

Error `404`: `NOT_FOUND`.

### `GET /dead-letters`

Response `200`: `{ "deadLetters": [ … ] }`.

### `GET /dead-letters/:webhookEventId`

Error `404`: `NOT_FOUND`.

---

## Exceptions (deterministic classification)

### `GET /exceptions`

Query: `status`, `severity`, `exceptionCode`, `provider`, `paymentId`, `webhookEventId`, `q`.

Error `400`: `INVALID_EXCEPTION_STATUS`, `INVALID_EXCEPTION_SEVERITY`, `INVALID_EXCEPTION_CODE`, `INVALID_PROVIDER`, `INVALID_PAYMENT_ID`, `INVALID_WEBHOOK_EVENT_ID`. `404`: `EXCEPTIONS_UNAVAILABLE`.

### `GET /exceptions/:id`

Error `404`: `EXCEPTION_NOT_FOUND`.

### `POST /exceptions/:id/investigate`

Purpose: request a read-only investigation. No JSON body required. Optional `X-Request-Id`.

Response `200`: `{ "investigation": { … } }`. Payment rows are not updated.

Error `404`: `INVESTIGATIONS_UNAVAILABLE`, `EXCEPTION_NOT_FOUND`. `503`: `INVESTIGATION_PERSISTENCE_FAILED`, `AUDIT_WRITE_FAILED`.

If the model path fails, an unavailable investigation record is still persisted when possible.

### `GET /exceptions/:id/investigations`

List for that exception.

### `GET /exceptions/:id/investigation`

Latest investigation. Error `404`: `INVESTIGATION_NOT_FOUND`.

---

## Incidents

Incidents are exception-backed operator records (same ids).

### `GET /incidents`

Same filters as exceptions, plus optional time bounds (`INVALID_INSTANT` on bad timestamps).

`404`: `INCIDENTS_UNAVAILABLE`.

### `GET /incidents/:id`

`404`: `INCIDENT_NOT_FOUND`.

### `GET /incidents/:id/timeline`

Stored chronology (audit + retry + exception). Query: `offset`, `limit` (`INVALID_OFFSET`, `INVALID_LIMIT`).

### `POST /incidents/:id/investigate`

Same handler as exception investigate.

### `GET /incidents/:id/investigations`

Same as exception list.

---

## Failure Lab (synthetic)

### `GET /failure-lab`

Response: `{ "notice", "synthetic": true, "scenarios": [ … ] }`.

### `POST /failure-lab/run`

Request JSON: `{ "scenario": "<catalog id>" }`. Extra fields such as `failureMode` are ignored.

Response `200`: `{ "run": <report from stored rows> }`.

Error `400`: `INVALID_JSON`, `MISSING_SCENARIO`, `UNKNOWN_FAILURE_LAB_SCENARIO`. `503`: `FAILURE_LAB_SECRET_UNAVAILABLE`, `RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE` (Razorpay-shaped scenarios).

### `GET /failure-lab/runs/:id`

In-memory report for this API process. `400`: `INVALID_RUN_ID`. `404`: `FAILURE_LAB_RUN_NOT_FOUND`.

### `POST /failure-lab/reset`

Request JSON: `{ "confirm": "SYNTHETIC_FAILURE_LAB" }`. Deletes only `SYNTHETIC:pay:lab-*` rows.

Error `400`: `INVALID_JSON`, `RESET_CONFIRMATION_REQUIRED`. `503`: `FAILURE_LAB_RESET_UNAVAILABLE`.

---

## Golden Demo (synthetic)

### `GET /demo`

JSON description (`kind: "SYNTHETIC DEMONSTRATION"`). Browser HTML to `/demo` is the SPA.

### `POST /demo/run`

No body. Always scenario `GOLDEN_DEMO`. Requires both synthetic and Razorpay webhook secrets in env (placeholders are enough).

Response `200`: `{ "demo": { demoRunId, correlationId, synthetic, notice, invariant, run } }`.

Error `503`: `FAILURE_LAB_SECRET_UNAVAILABLE`, `RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE`. `500`: `DEMO_FAILED`.

### `GET /demo/runs`

In-memory Golden Demo reports for this process (max 10).

### `GET /demo/runs/:id`

`400`: `INVALID_DEMO_RUN_ID`. `404`: `DEMO_RUN_NOT_FOUND`.

---

## Audit by correlation

### `GET /audit?correlationId=`

Required query `correlationId`. `400`: `MISSING_CORRELATION_ID`.

Response `200`: `{ "audit": [ … ] }`.
