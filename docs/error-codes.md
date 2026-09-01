# Error codes

Codes that appear in HTTP JSON, stored exceptions, or retry/dead-letter rows. Do not invent aliases in the UI.

`PROCESSING_FAILED` is a **log lifecycle**, not an HTTP `code`. Ingest uses `TEMPORARY_PROCESSING_FAILURE`. Exceptions use `PROCESSING_FAILURE`.

---

## Pipeline / ingest (`POST /webhooks/:provider`)

From `apps/api/src/pipeline/errors.ts`, signature results, and adapter `WebhookError`.

| Code | Typical HTTP | Meaning |
| --- | --- | --- |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body is not `application/json` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 256 KiB |
| `UNSUPPORTED_PROVIDER` | 404 | No verifier for `:provider` |
| `MISSING_SIGNATURE` | 401 | Required signature header absent |
| `INVALID_SIGNATURE` | 401 | HMAC does not match |
| `EXPIRED_SIGNATURE` | 401 | Synthetic timestamp outside tolerance |
| `MALFORMED_SIGNATURE` | 400 | Signature header cannot be parsed |
| `INVALID_PAYLOAD` | 400 | JSON parse or adapter validation |
| `UNSUPPORTED_EVENT` | 400 | Known provider, unknown event name |
| `MISSING_EXTERNAL_ID` | 400 | Razorpay event id header missing |
| `MISSING_PAYMENT_ID` | 400 | Payment id missing in payload |
| `INVALID_AMOUNT` | 400 | Amount cannot be normalized |
| `INVALID_CURRENCY` | 400 | Currency cannot be normalized |
| `INVALID_TIMESTAMP` | 400 | Occurred-at cannot be normalized |
| `CONFLICT` | 409 | Same identity, different payload hash |
| `TEMPORARY_PROCESSING_FAILURE` | 500 | Stored event; processing retryable or retry write failed |
| `INTERNAL_ERROR` | 500 | Uncaught `onError` in `createApp` |

Successful ingest uses body `status` `accepted` or `duplicate` without an error `code`.

---

## Exception taxonomy (`exceptionCode`)

From `packages/exceptions/src/codes.ts`. Persisted on exception/incident rows.

| Code | Meaning |
| --- | --- |
| `INVALID_SIGNATURE` | HMAC missing, invalid, or expired. Nothing stored as a webhook event. |
| `MALFORMED_WEBHOOK` | Malformed header, invalid JSON, or adapter validation. |
| `UNSUPPORTED_EVENT` | Unknown provider or unknown event name. |
| `DUPLICATE_EVENT` | Identical redelivery. No second economic effect. |
| `CONFLICTING_EVENT` | Same identity, different hash. Original row kept. |
| `OUT_OF_ORDER_EVENT` | Stored but delayed awaiting a prerequisite. |
| `MISSING_EVENT` | Out-of-order delay with a unique missing predecessor in the table. |
| `INVALID_STATE_TRANSITION` | State machine / replay rejects the event. |
| `PROCESSING_FAILURE` | Temporary processing failure; retry scheduled. |
| `RETRY_EXHAUSTED` | Retry budget consumed; dead-lettered. |

---

## Retry / dead-letter

Retry rows store `lastErrorCode` (for example `TEMPORARY_UNAVAILABLE` from lab injection, or state-machine `INVALID_TRANSITION`). Dead-letter `failureCode` is the terminal classification. These are not a second HTTP vocabulary.

Retry `status`: `PENDING`, `PROCESSING`, `SUCCEEDED`, `RETRY_SCHEDULED`, `DEAD_LETTERED`.

---

## Read API

| Code | Typical HTTP | Where |
| --- | --- | --- |
| `READINESS_UNAVAILABLE` | 503 | `GET /ready` with no ping |
| `DEPENDENCY_UNAVAILABLE` | 503 | `GET /ready` ping failed |
| `WEBHOOK_NOT_FOUND` | 404 | webhook read |
| `PAYMENT_NOT_FOUND` | 404 | payment read |
| `PAYMENTS_UNAVAILABLE` | 404 | payment store not wired |
| `EXCEPTION_NOT_FOUND` | 404 | exception / investigate |
| `EXCEPTIONS_UNAVAILABLE` | 404 | exception store not wired |
| `INCIDENT_NOT_FOUND` | 404 | incident read |
| `INCIDENTS_UNAVAILABLE` | 404 | incident store not wired |
| `INVESTIGATION_NOT_FOUND` | 404 | latest investigation missing |
| `INVESTIGATIONS_UNAVAILABLE` | 404 | investigation store not wired |
| `INVESTIGATION_PERSISTENCE_FAILED` | 503 | investigate persist |
| `AUDIT_WRITE_FAILED` | 503 | investigation audit append |
| `NOT_FOUND` | 404 | retry / dead-letter by webhook id |
| `MISSING_CORRELATION_ID` | 400 | `GET /audit` |
| `INVALID_PAYMENT_ID` | 400 | path/query parse |
| `INVALID_PROVIDER` | 400 | query parse |
| `INVALID_EVENT_TYPE` | 400 | webhook list |
| `INVALID_PROCESSING_STATUS` | 400 | webhook list |
| `INVALID_PAYMENT_STATE` | 400 | payment list |
| `INVALID_EXCEPTION_STATUS` | 400 | exception/incident list |
| `INVALID_EXCEPTION_SEVERITY` | 400 | list |
| `INVALID_EXCEPTION_CODE` | 400 | list |
| `INVALID_WEBHOOK_EVENT_ID` | 400 | exception list |
| `INVALID_INSTANT` | 400 | incident time filter |
| `INVALID_INCIDENT_ID` | 400 | incident id parse |
| `INVALID_OFFSET` / `INVALID_LIMIT` | 400 | timeline paging |

---

## Failure Lab and Golden Demo

| Code | Typical HTTP | Meaning |
| --- | --- | --- |
| `INVALID_JSON` | 400 | Body is not JSON |
| `MISSING_SCENARIO` | 400 | Lab run missing `scenario` |
| `UNKNOWN_FAILURE_LAB_SCENARIO` | 400 | Name not in catalog |
| `INVALID_RUN_ID` / `INVALID_DEMO_RUN_ID` | 400 | Path is not a UUID |
| `FAILURE_LAB_RUN_NOT_FOUND` | 404 | In-memory lab report missing |
| `DEMO_RUN_NOT_FOUND` | 404 | In-memory demo report missing |
| `RESET_CONFIRMATION_REQUIRED` | 400 | Reset confirm string mismatch |
| `FAILURE_LAB_SECRET_UNAVAILABLE` | 503 | `HOOKX_SYNTHETIC_WEBHOOK_SECRET` unset |
| `RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE` | 503 | Razorpay-shaped lab without secret |
| `FAILURE_LAB_RESET_UNAVAILABLE` | 503 | Purge function not wired |
| `DEMO_FAILED` | 500 | Golden Demo runner threw |

Console-only (not API): `REQUEST_FAILED`, `UNEXPECTED_DEMO_OUTCOME`, `INVESTIGATION_FAILED` when the browser cannot classify a network error.
