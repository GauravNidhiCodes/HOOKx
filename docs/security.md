# Security

This document describes controls that exist in the code. It is not a penetration-test report.

## Secrets

- `.env` is gitignored. `.env.example` lists names only. `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are unused placeholders; webhook ingest reads `RAZORPAY_WEBHOOK_SECRET`.
- Webhook secrets and `HOOKX_OPENAI_API_KEY` are read from the environment. They are not hardcoded. Simulator/dev HMAC material is explicitly `dev-only-…` for local synthetic traffic.
- Signature headers are verified; expected signatures and secrets are not returned on HTTP responses.

## Logging and API errors

- Structured logs redact webhook secrets and similar keys.
- Investigation sanitizes evidence (blocked keys and credential-shaped values).
- HTTP error bodies use stable codes. Stack traces and database errors are not returned to clients.

## Provider signatures

- Verification runs on the original raw body before JSON parse.
- Raw webhook payloads, HMAC signatures, and API keys are not stored on webhook event rows.

## Investigation credentials

- OpenAI configuration stays in the investigator adapter. The operator console never receives the API key.
- Investigation does not execute refunds, captures, or payment updates.

## Destructive operations

- Failure Lab reset requires confirmation `SYNTHETIC_FAILURE_LAB` and deletes only `SYNTHETIC:pay:lab-*` rows.
- There is no operator control to truncate non-lab payment rows.

## Input

- Failure Lab scenario ids are enumerated. Unknown names return `400 UNKNOWN_FAILURE_LAB_SCENARIO`. Extra JSON fields such as `failureMode` are ignored; injection mode comes from the server catalog. `POST /demo/run` always runs `GOLDEN_DEMO`; it cannot select an arbitrary payment to mutate.
- Webhook providers are enumerated (`SYNTHETIC`, `razorpay`). Unknown providers are not ingested as valid events.
- `POST /webhooks/:provider` requires `application/json` (415 otherwise) and rejects bodies over 256 KiB (413).

## Authentication

The HTTP API and operator console are unauthenticated. They are a local operator workspace, not a multi-tenant control plane. Do not expose them on a public network without an authenticating proxy.
