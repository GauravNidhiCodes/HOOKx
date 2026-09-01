import { describe, expect, it } from "vitest";
import { instant, paymentId } from "@hookx/domain";
import {
  generateDeliveries,
  getScenario,
  SCENARIO_ID,
  SIMULATOR_SECRET,
} from "@hookx/simulator";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryInvestigationRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
  createSequentialOutcomeWriter,
  isFailureLabPaymentId,
  purgeMemoryFailureLab,
} from "@hookx/storage";
import { syntheticPaymentCreated } from "@hookx/testkit";
import {
  createSignatureVerifierRegistry,
  SYNTHETIC_SIGNATURE_HEADER,
} from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";
import { createLabProcessFn } from "./injection.js";
import { FAILURE_LAB_RESET_CONFIRM } from "./http.js";
import type { FailureLabRunReport } from "./report.js";

const NOW = instant("2026-01-15T10:00:01.000Z");

function labStack() {
  const repository = new MemoryWebhookEventRepository();
  const retry = new MemoryRetryRepository();
  const audit = new MemoryAuditRepository();
  const payments = new MemoryPaymentRepository();
  const exceptions = new MemoryExceptionRepository();
  const investigations = new MemoryInvestigationRepository();
  return {
    repository,
    retry,
    audit,
    payments,
    exceptions,
    investigations,
    persistOutcome: createSequentialOutcomeWriter(repository, audit, payments),
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SIMULATOR_SECRET,
      syntheticToleranceSeconds: 300,
    }),
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 8_000 },
    leaseMs: 2_000,
    clock: fixedClock(NOW),
    syntheticWebhookSecret: SIMULATOR_SECRET,
    purgeFailureLab: async () =>
      purgeMemoryFailureLab({
        webhooks: repository,
        payments,
        exceptions,
        audit,
        retry,
        investigations,
      }),
  };
}

async function runScenario(
  app: ReturnType<typeof createApp>,
  scenario: string,
): Promise<FailureLabRunReport> {
  const response = await app.request("/failure-lab/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { run: FailureLabRunReport };
  return body.run;
}

describe("Failure Lab HTTP", () => {
  it("rejects an unknown scenario", async () => {
    const app = createApp(labStack());
    const response = await app.request("/failure-lab/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "EXPLODE_EVERYTHING" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "bad_request",
      code: "UNKNOWN_FAILURE_LAB_SCENARIO",
    });
  });

  it("ignores a client-supplied failureMode and uses the catalog mode", async () => {
    const app = createApp(labStack());
    const response = await app.request("/failure-lab/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "DUPLICATE_DELIVERY",
        failureMode: "ALWAYS_FAIL",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: FailureLabRunReport };
    expect(body.run.failureMode).toBe("NONE");
    expect(body.run.payment.state).toBe("CREATED");
    expect(body.run.stateChange).toBe(1);
  });

  it("requires reset confirmation", async () => {
    const app = createApp(labStack());
    const response = await app.request("/failure-lab/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "TRUNCATE" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "bad_request",
      code: "RESET_CONFIRMATION_REQUIRED",
    });
  });

  it("does not inject failures for simulator ids on a miswired ALWAYS_FAIL processor", async () => {
    const stack = labStack();
    const app = createApp({
      ...stack,
      processPaymentEvents: createLabProcessFn("ALWAYS_FAIL"),
    });
    const deliveries = generateDeliveries(
      getScenario(SCENARIO_ID.DUPLICATE_DELIVERY),
      { secret: SIMULATOR_SECRET, now: NOW },
    );
    const first = deliveries[0];
    expect(first).toBeDefined();
    const response = await app.request("/webhooks/SYNTHETIC", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "safety-non-lab",
        [SYNTHETIC_SIGNATURE_HEADER]: first!.signature,
      },
      body: first!.rawBody,
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe(
      "accepted",
    );
  });

  it("runs duplicate delivery through ingest twice and stays idempotent", async () => {
    const stack = labStack();
    const app = createApp(stack);
    const kept = await stack.repository.store(
      syntheticPaymentCreated({
        paymentId: paymentId("SYNTHETIC:pay:sim-keep"),
        externalEventId: "SYNTHETIC:evt:sim-keep-created",
        payloadHash: "SYNTHETIC:hash:sim-keep",
      }),
    );
    expect(kept.outcome).toBe("STORED");

    const body = await runScenario(app, "DUPLICATE_DELIVERY");
    expect(body.synthetic).toBe(true);
    expect(body.notice).toBe(
      "The Failure Lab never sends real payment requests.",
    );
    expect(body.result.duplicate).toBe(1);
    expect(body.result.accepted).toBe(1);
    expect(body.stateChange).toBe(1);
    expect(body.payment.state).toBe("CREATED");
    expect(isFailureLabPaymentId(body.payment.paymentId)).toBe(true);
    expect(body.exception?.exceptionCode).toBe("DUPLICATE_EVENT");
    expect(body.auditCount).toBeGreaterThanOrEqual(2);
    expect(body.log.length).toBeGreaterThan(0);
    expect(
      stack.repository.records.filter((row) =>
        isFailureLabPaymentId(row.event.paymentId),
      ),
    ).toHaveLength(1);

    const again = await runScenario(app, "DUPLICATE_DELIVERY");
    expect(again.runId).not.toBe(body.runId);
    expect(
      stack.repository.records.filter((row) =>
        isFailureLabPaymentId(row.event.paymentId),
      ),
    ).toHaveLength(2);

    const listed = await app.request("/failure-lab");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain(
      "The Failure Lab never sends real payment requests.",
    );

    const fetched = await app.request(`/failure-lab/runs/${body.runId}`);
    expect(fetched.status).toBe(200);

    const reset = await app.request("/failure-lab/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: FAILURE_LAB_RESET_CONFIRM }),
    });
    expect(reset.status).toBe(200);
    expect(
      stack.repository.records.filter((row) =>
        isFailureLabPaymentId(row.event.paymentId),
      ),
    ).toHaveLength(0);
    expect(
      stack.repository.records.some(
        (row) => row.event.paymentId === "SYNTHETIC:pay:sim-keep",
      ),
    ).toBe(true);
    expect(stack.payments.records.every((row) => !isFailureLabPaymentId(row.paymentId))).toBe(
      true,
    );
  });

  it("delivers out of order through the state machine", async () => {
    const app = createApp(labStack());
    const report = await runScenario(app, "OUT_OF_ORDER");
    expect(report.input.eventOrderSent).toEqual([
      "payment.created",
      "payment.captured",
      "payment.authorized",
    ]);
    expect(report.input.eventTimeOrder).toEqual([
      "payment.created",
      "payment.authorized",
      "payment.captured",
    ]);
    expect(report.payment.state).toBe("CAPTURED");
    expect(report.replay?.delayed).toBe(true);
    expect(report.exception?.exceptionCode).toBe("OUT_OF_ORDER_EVENT");
    expect(report.result.accepted).toBe(3);
  });

  it("keeps the original event when a conflicting payload arrives", async () => {
    const stack = labStack();
    const app = createApp(stack);
    const report = await runScenario(app, "CONFLICTING_EVENT");
    expect(report.result.conflict).toBe(1);
    expect(report.result.accepted).toBe(1);
    expect(report.originalAmountMinor).toBe("10000");
    expect(report.payment.state).toBe("CREATED");
    expect(report.stateChange).toBe(1);
    expect(report.exception?.exceptionCode).toBe("CONFLICTING_EVENT");
    const labEvents = stack.repository.records.filter((row) =>
      isFailureLabPaymentId(row.event.paymentId),
    );
    expect(labEvents).toHaveLength(1);
    expect(labEvents[0]?.event.payloadHash).toBe(report.originalPayloadHash);
    expect(labEvents[0]?.event.amountMinor.toString()).toBe("10000");
  });

  it("recovers from a single synthetic processing failure", async () => {
    const app = createApp(labStack());
    const report = await runScenario(app, "TRANSIENT_FAILURE");
    expect(report.failureMode).toBe("FAIL_ONCE");
    expect(report.result.error).toBe(1);
    expect(report.retry?.status).toBe("SUCCEEDED");
    expect(report.retry?.attemptCount).toBeGreaterThanOrEqual(2);
    expect(report.payment.state).toBe("CREATED");
    expect(report.stateChange).toBe(1);
    expect(report.deadLetter).toBeNull();
    expect(report.exception?.exceptionCode).toBe("PROCESSING_FAILURE");
    expect(report.demoRun).toBe(true);
    expect(report.labels).toEqual(["SYNTHETIC", "DEMO RUN"]);
  });

  it("dead-letters after the configured retry policy is exhausted", async () => {
    const app = createApp(labStack());
    const report = await runScenario(app, "RETRY_EXHAUSTION");
    expect(report.failureMode).toBe("ALWAYS_FAIL");
    expect(report.retryPolicy.maxAttempts).toBe(2);
    expect(report.retry?.status).toBe("DEAD_LETTERED");
    expect(report.retry?.attemptCount).toBe(2);
    expect(report.deadLetter).not.toBeNull();
    expect(report.deadLetter?.attemptCount).toBe(2);
    expect(report.payment.state).toBeNull();
    expect(report.stateChange).toBe(0);
    expect(report.exception?.exceptionCode).toBe("RETRY_EXHAUSTED");
  });

  it("replays delayed capture without duplicating the created transition", async () => {
    const stack = labStack();
    const app = createApp(stack);
    const report = await runScenario(app, "REPLAY_RECOVERY");
    expect(report.replay?.beforeState).toBe("CREATED");
    expect(report.replay?.afterState).toBe("CAPTURED");
    expect(report.replay?.delayed).toBe(true);
    expect(report.payment.state).toBe("CAPTURED");
    const createdTransitions = stack.audit.records.filter(
      (row) =>
        isFailureLabPaymentId(row.paymentId) &&
        row.eventType === "PAYMENT_STATE_CHANGED" &&
        row.resultingState === "CREATED",
    );
    expect(createdTransitions).toHaveLength(1);
  });
});
