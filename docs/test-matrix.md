# Test matrix

Automated coverage for reliability scenarios. Tests use the real processing path unless noted. AI network calls are stubbed.

| Scenario | Expected behavior | Automated test | Failure recovery | Audit behavior |
| --- | --- | --- | --- | --- |
| Duplicate delivery | Same identity, same hash: HTTP `duplicate`; one stored event; one economic transition | `apps/api/src/failure-lab/scenarios.e2e.test.ts` (`DUPLICATE`); `pipeline.e2e.test.ts` (13 concurrent identical POSTs); ingest sequential redelivery | No second capture/create | `WEBHOOK_DUPLICATE`; `DUPLICATE_EVENT` exception |
| Out-of-order delivery | Capture delayed until authorized exists; final `CAPTURED`; no invented transition | `scenarios.e2e.test.ts` (`OUT_OF_ORDER`); `@hookx/state-machine` `replay.test.ts` | Delayed event applied on replay | `WEBHOOK_DELAYED`; state changes from replay |
| Conflicting event | Same identity, different hash: HTTP `conflict`; original row unchanged | `scenarios.e2e.test.ts` (`CONFLICTING_EVENT`); ingest conflict tests | No overwrite, no second transition | `WEBHOOK_CONFLICT`; `CONFLICTING_EVENT` |
| Transient failure | First process fails; retry scheduled; retry succeeds; payment `CREATED` | `scenarios.e2e.test.ts` (`TRANSIENT_FAILURE`); `http.test.ts` recover; `demo.e2e.test.ts` | Retry `SUCCEEDED`; no dead letter | `RETRY_SCHEDULED` / `RETRY_ATTEMPTED` / `RETRY_SUCCEEDED`; `PROCESSING_FAILURE` |
| Retry exhaustion | Failures until configured max attempts; dead-letter; no payment projection | `scenarios.e2e.test.ts` (`RETRY_EXHAUSTION`); retry integration in `@hookx/storage` | Dead-letter; operator inspects | `RETRY_DEAD_LETTERED`; `RETRY_EXHAUSTED` |
| Replay recovery | Capture before authorization stored; replay when missing event arrives; created not applied twice | `scenarios.e2e.test.ts` (`REPLAY_RECOVERY`); `replay.test.ts` | Final `CAPTURED` from ordered log | `WEBHOOK_DELAYED`; single `CREATED` transition |
| Razorpay-shaped duplicate | Signed synthetic Razorpay envelope twice through `/webhooks/razorpay`; one stored event; no invented `payment.created` | `scenarios.e2e.test.ts` (`RAZORPAY_SHAPED_DUPLICATE`); `packages/webhook/src/razorpay/contract.test.ts`; `apps/api/src/http/razorpay.e2e.test.ts` | Duplicate HTTP; payment projection stays empty | `WEBHOOK_DUPLICATE`; `DUPLICATE_EVENT` |

Architecture demo (full story): `apps/api/src/failure-lab/demo.e2e.test.ts` — Failure Lab run → processing → incident → timeline → investigation (stub) → `INVESTIGATION_RECORDED`. Payment unchanged by investigation.

AI investigator on each lab scenario: `apps/api/src/failure-lab/investigate.e2e.test.ts`.

Operator console: `apps/web/src/pages/*.test.tsx` (Overview, Failure Lab, incidents, empty/error/loading).

Quality gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. GitHub Actions runs the same commands with a PostgreSQL 16 service.
