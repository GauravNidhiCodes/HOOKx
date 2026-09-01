# LOCAL SYNTHETIC BENCHMARK

These numbers are **not** production SLAs, throughput guarantees, or capacity claims. They were measured once on a developer machine against in-process memory repositories (no PostgreSQL, no HTTP server, no network). Do not copy them into the UI or treat them as HOOKX performance.

## Environment

- Date: 2026-09-01
- OS: macOS darwin 25.5.0
- Runtime: Node.js v24.11.1, Vitest 3.2.7
- Path: `POST /webhooks/SYNTHETIC` through `createApp` with `MemoryWebhookEventRepository` and `createSequentialOutcomeWriter`
- Clock: fixed test clock
- Secret: local placeholder HMAC (`dev-only-synthetic-webhook-secret`)

## Unique events (one economic effect each)

| Events | Result | Approximate Vitest duration |
| --- | --- | --- |
| 100 | 100 accepted, 0 failed, 100 `PAYMENT_STATE_CHANGED` | 32 ms |
| 500 | 500 accepted, 0 failed, 500 `PAYMENT_STATE_CHANGED` | 89 ms |
| 1000 | 1000 accepted, 0 failed, 1000 `PAYMENT_STATE_CHANGED` | 190 ms |

## Duplicate handling

| Deliveries | Result | Approximate Vitest duration |
| --- | --- | --- |
| 1000 identical | 1 accepted, 999 duplicate, one stored event, one `PAYMENT_STATE_CHANGED` | 66 ms |

PostgreSQL unique-constraint duplicate handling (100 sequential identical POSTs against `hookx_pipeline_test`) is covered by `apps/api/src/pipeline/pipeline.e2e.test.ts` (~196 ms in the same run). That is also a local synthetic measurement, not a production guarantee.

Automated source: `apps/api/src/pipeline/throughput.smoke.test.ts`.
