# Test matrix

Automated coverage for reliability scenarios. Tests use the real processing path unless noted. AI network calls are stubbed.

| Scenario | Expected behavior | Automated test | Failure recovery | Audit behavior |
| --- | --- | --- | --- | --- |
| Duplicate delivery | Same identity, same hash: HTTP `duplicate`; one stored event; one economic transition | `pipeline.e2e.test.ts` (100 sequential + 13 concurrent); `webhooks.test.ts` (100 memory); `scenarios.e2e.test.ts` (`DUPLICATE`) | No second capture/create | `WEBHOOK_DUPLICATE`; `DUPLICATE_EVENT` exception |
| Out-of-order delivery | Capture delayed until authorized exists; final `CAPTURED`; no invented transition | `scenarios.e2e.test.ts` (`OUT_OF_ORDER`); `@hookx/state-machine` `replay.test.ts` | Delayed event applied on replay | `WEBHOOK_DELAYED`; state changes from replay |
| Conflicting event | Same identity, different hash: HTTP `conflict`; original row unchanged | `scenarios.e2e.test.ts` (`CONFLICTING_EVENT`); ingest conflict tests | No overwrite, no second transition | `WEBHOOK_CONFLICT`; `CONFLICTING_EVENT` |
| Transient failure | First process fails; retry scheduled; retry succeeds; payment `CREATED` | `scenarios.e2e.test.ts` (`TRANSIENT_FAILURE`); `http.test.ts` recover; `demo.e2e.test.ts` | Retry `SUCCEEDED`; no dead letter | `RETRY_SCHEDULED` / `RETRY_ATTEMPTED` / `RETRY_SUCCEEDED`; `PROCESSING_FAILURE` |
| Retry exhaustion | Failures until configured max attempts; dead-letter; no payment projection | `scenarios.e2e.test.ts` (`RETRY_EXHAUSTION`); retry integration in `@hookx/storage` | Dead-letter; operator inspects | `RETRY_DEAD_LETTERED`; `RETRY_EXHAUSTED` |
| Replay recovery | Capture before authorization stored; replay when missing event arrives; created not applied twice | `scenarios.e2e.test.ts` (`REPLAY_RECOVERY`); `replay.test.ts` | Final `CAPTURED` from ordered log | `WEBHOOK_DELAYED`; single `CREATED` transition |
| Razorpay-shaped duplicate | Signed synthetic Razorpay envelope twice through `/webhooks/razorpay`; one stored event; no invented `payment.created` | `scenarios.e2e.test.ts` (`RAZORPAY_SHAPED_DUPLICATE`); `packages/webhook/src/razorpay/contract.test.ts`; `apps/api/src/http/razorpay.e2e.test.ts` | Duplicate HTTP; payment projection stays empty | `WEBHOOK_DUPLICATE`; `DUPLICATE_EVENT` |
| Golden Demo | Unique synthetic `payment.created` webhook; HMAC; normalize; ingest; fail-once; retry succeeds; duplicate redelivery; one stored event; payment `CREATED` once; audit; incident timeline; stub investigation; no second economic effect | `apps/api/src/demo/golden.e2e.test.ts`; `apps/web/src/pages/Demo.test.tsx` | Retry `SUCCEEDED`; event `PROCESSED`; state `CREATED` | Retry + `PROCESSING_FAILURE` + duplicate audit |
| Golden Demo exhaustion | Synthetic lab payment with `ALWAYS_FAIL` | `apps/api/src/demo/exhaustion.e2e.test.ts` | Dead-letter; UI would show **RETRY EXHAUSTED**, not recovery | `RETRY_DEAD_LETTERED`; `RETRY_EXHAUSTED` |

Architecture demo (full story): `apps/api/src/failure-lab/demo.e2e.test.ts` — Failure Lab run → processing → incident → timeline → investigation (stub) → `INVESTIGATION_RECORDED`. Payment unchanged by investigation.

Golden Demo (operator `/demo`): `apps/api/src/demo/golden.e2e.test.ts`.

AI investigator on each lab scenario: `apps/api/src/failure-lab/investigate.e2e.test.ts`.

Operator console: `apps/web/src/pages/*.test.tsx` (Overview, Failure Lab, incidents, empty/error/loading).

Quality gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Schema: `pnpm migrate` (`HOOKX_DATABASE_URL`; does not create the database). GitHub Actions runs the four gates against a disposable PostgreSQL 16 service (`HOOKX_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hookx_test`). No deploy job. No CI secrets.

Malformed / signature / money HTTP cases: `apps/api/src/http/webhooks.test.ts`, `apps/api/src/http/razorpay.e2e.test.ts`. Store / persist failure: `apps/api/src/ingest/ingest-webhook.test.ts`. AI timeout and malformed model output: `packages/investigation/src/openai-provider.test.ts`, `apps/api/src/http/investigation.test.ts`. Golden Demo isolation (three consecutive runs): `apps/api/src/demo/golden.e2e.test.ts`.

Local in-process timings (not SLAs): [local-synthetic-benchmark.md](local-synthetic-benchmark.md).
