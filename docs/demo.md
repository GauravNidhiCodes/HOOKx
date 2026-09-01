# Architecture demo

This sequence uses the **real** ingest pipeline. It does not fake UI results.

The polished Golden Demo (Razorpay adapter + fail-once) lives at `/demo`. See `docs/golden-demo.md`.

Every Failure Lab run is labelled **SYNTHETIC**. The architecture demo is also labelled **DEMO RUN**. Payment ids are `SYNTHETIC:pay:lab-{runId}`.

## Fresh local setup

1. Install Node.js 22+ and pnpm 11. Start PostgreSQL 16+.
2. From the repository root:

```bash
pnpm install
cp .env.example .env
```

3. Set at least:

```
HOOKX_DATABASE_URL=postgres://USER@127.0.0.1:5432/hookx
HOOKX_SYNTHETIC_WEBHOOK_SECRET=dev-only-synthetic-webhook-secret
```

4. Apply migrations and start both processes:

```bash
pnpm --filter @hookx/storage db:migrate
pnpm dev
```

5. Open `http://127.0.0.1:5173` (API is `http://127.0.0.1:8787`).

`HOOKX_INVESTIGATION_PROVIDER` may stay `stub`. A live OpenAI key is not required for the demo.

## Demonstration sequence

1. **Overview.** Confirm the one-sentence product description, architecture flow, and principles. If the database is empty, persisted state shows **NO DATA**.
2. **Failure Lab.** Primary nav → Failure Lab. The page states **THIS IS SYNTHETIC**.
3. **Run scenario.** Open **04 — TRANSIENT FAILURE** (labelled **SYNTHETIC · DEMO RUN**, also `#architecture-demo`). Read **WHAT WE SIMULATE** and **WHAT HOOKX SHOULD DO**. Click **RUN**.
4. **View result.** **WHAT ACTUALLY HAPPENED** is the backend report: deliveries, retry `SUCCEEDED`, payment `CREATED`, `PROCESSING_FAILURE` incident, audit count, execution log. Identifiers include a unique `runId`.
5. **View incident.** **VIEW INCIDENT** opens the persisted incident (not a frontend simulation).
6. **View timeline.** **VIEW TIMELINE** (or the timeline on the incident) shows timestamp, event, decision, result. Event / received / processed times appear when stored.
7. **Investigate.** **INVESTIGATE INCIDENT**. Banners: **AI-GENERATED INVESTIGATION**, **READ-ONLY**, **NO FINANCIAL STATE CHANGES**. The deterministic result section remains the financial authority.
8. **View evidence.** Evidence citations link to exception, event, or incident records. **VIEW EVIDENCE** from the lab report opens the stored webhook.
9. **Verify audit.** Incident timeline includes investigation availability. The API writes `INVESTIGATION_RECORDED`. Payment state after investigation matches payment state before investigation.

Operator path, without extra navigation:

Failure Lab → Run Scenario → View Result → View Incident → View Timeline → Investigate → View Evidence

## Automated equivalent

`apps/api/src/failure-lab/demo.e2e.test.ts` runs TRANSIENT_FAILURE through the real app, then incident timeline, investigation (stub), and audit. PostgreSQL required.
