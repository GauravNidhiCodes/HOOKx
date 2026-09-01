import { describe, expect, it } from "vitest";
import { instant, isoCurrencyCode, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import {
  InvestigationError,
  INVESTIGATION_ERROR_CODE,
  INVESTIGATION_PROMPT_VERSION,
  StubInvestigator,
  UnavailableInvestigator,
  type InvestigationContext,
  type InvestigationResult,
  type Investigator,
} from "@hookx/investigation";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryInvestigationRepository,
  MemoryPaymentRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { syntheticPaymentCreated } from "@hookx/testkit";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const SECRET = "dev-only-synthetic-webhook-secret";
const PAYMENT = paymentId("SYNTHETIC:pay:inv-http");
const PROVIDER = providerId("SYNTHETIC");

class ThrowingInvestigator implements Investigator {
  public readonly implementation = "test-throw";
  public readonly modelId = "test";
  public readonly promptVersion = INVESTIGATION_PROMPT_VERSION;

  public constructor(private readonly error: InvestigationError) {}

  public async investigate(
    _context: InvestigationContext,
  ): Promise<InvestigationResult> {
    throw this.error;
  }
}

async function seedException(
  repository: MemoryWebhookEventRepository,
  exceptions: MemoryExceptionRepository,
  payments: MemoryPaymentRepository,
) {
  const stored = await repository.store(
    syntheticPaymentCreated({
      paymentId: PAYMENT,
      externalEventId: "SYNTHETIC:evt:inv-http",
      payloadHash: "SYNTHETIC:hash:inv-http",
    }),
  );
  expect(stored.outcome).toBe("STORED");
  if (stored.outcome !== "STORED") {
    throw new Error("expected stored webhook");
  }
  await payments.upsert({
    provider: PROVIDER,
    paymentId: PAYMENT,
    state: "CREATED",
    amountMinor: 10000n,
    currency: isoCurrencyCode("INR"),
    lastOccurredAt: NOW,
    updatedAt: NOW,
  });
  const created = await exceptions.create(
    createExceptionDraft({
      exceptionCode: "CONFLICTING_EVENT",
      paymentId: PAYMENT,
      webhookEventId: stored.record.id,
      provider: PROVIDER,
      reason: "CONFLICTING_EVENT",
      detectedAt: NOW,
      correlationId: "corr-inv-http",
    }),
  );
  return { stored: stored.record, exception: created.record };
}

function appOf(options: {
  readonly repository: MemoryWebhookEventRepository;
  readonly exceptions: MemoryExceptionRepository;
  readonly investigations: MemoryInvestigationRepository;
  readonly payments: MemoryPaymentRepository;
  readonly investigator?: Investigator;
}) {
  return createApp({
    repository: options.repository,
    retry: new MemoryRetryRepository(),
    audit: new MemoryAuditRepository(),
    payments: options.payments,
    exceptions: options.exceptions,
    investigations: options.investigations,
    investigator: options.investigator,
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(NOW),
  });
}

describe("investigation HTTP", () => {
  it("investigates with the stub and leaves exception and payment unchanged", async () => {
    const repository = new MemoryWebhookEventRepository();
    const exceptions = new MemoryExceptionRepository();
    const investigations = new MemoryInvestigationRepository();
    const payments = new MemoryPaymentRepository();
    const { exception } = await seedException(repository, exceptions, payments);
    const app = appOf({
      repository,
      exceptions,
      investigations,
      payments,
      investigator: new StubInvestigator(),
    });

    const missing = await app.request(
      `/exceptions/${exception.exceptionId}/investigation`,
    );
    expect(missing.status).toBe(404);

    const posted = await app.request(
      `/exceptions/${exception.exceptionId}/investigate`,
      { method: "POST", headers: { "x-request-id": "corr-inv-http-post" } },
    );
    expect(posted.status).toBe(200);
    const postedBody = (await posted.json()) as {
      investigation: {
        investigator: string;
        result: {
          evidence: Array<{ sourceType: string; sourceId: string }>;
          recommendedAction: { executable: boolean; code: string };
          likelyCause: string;
          facts: string[];
          confidence: string;
        };
      };
    };
    expect(postedBody.investigation.investigator).toBe("stub");
    expect(postedBody.investigation.result.recommendedAction.executable).toBe(
      false,
    );
    expect(postedBody.investigation.result.confidence).toBe("MEDIUM");
    expect(
      postedBody.investigation.result.evidence.some(
        (item) => item.sourceId === exception.exceptionId,
      ),
    ).toBe(true);
    expect(postedBody.investigation.result.likelyCause.toLowerCase()).toMatch(
      /\bmay have\b/,
    );
    for (const fact of postedBody.investigation.result.facts) {
      expect(fact.toLowerCase()).not.toMatch(/\bmay have\b/);
    }

    const got = await app.request(
      `/exceptions/${exception.exceptionId}/investigation`,
    );
    expect(got.status).toBe(200);

    expect(await exceptions.findById(exception.exceptionId)).toEqual(exception);
    expect(await payments.get(PROVIDER, PAYMENT)).toMatchObject({
      state: "CREATED",
      amountMinor: 10000n,
    });
  });

  it("returns a controlled unavailable result when the provider fails", async () => {
    const repository = new MemoryWebhookEventRepository();
    const exceptions = new MemoryExceptionRepository();
    const investigations = new MemoryInvestigationRepository();
    const payments = new MemoryPaymentRepository();
    const { exception } = await seedException(repository, exceptions, payments);
    const app = appOf({
      repository,
      exceptions,
      investigations,
      payments,
      investigator: new ThrowingInvestigator(
        new InvestigationError(
          INVESTIGATION_ERROR_CODE.PROVIDER_UNAVAILABLE,
          "AI provider returned an error",
        ),
      ),
    });
    const posted = await app.request(
      `/exceptions/${exception.exceptionId}/investigate`,
      { method: "POST" },
    );
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as {
      investigation: { investigator: string; result: { confidence: string } };
    };
    expect(body.investigation.investigator).toBe("unavailable");
    expect(body.investigation.result.confidence).toBe("LOW");
    expect(await exceptions.findById(exception.exceptionId)).toEqual(exception);
  });

  it("does not persist hallucinated evidence when the model is invalid", async () => {
    const repository = new MemoryWebhookEventRepository();
    const exceptions = new MemoryExceptionRepository();
    const investigations = new MemoryInvestigationRepository();
    const payments = new MemoryPaymentRepository();
    const { exception } = await seedException(repository, exceptions, payments);
    const app = appOf({
      repository,
      exceptions,
      investigations,
      payments,
      investigator: new ThrowingInvestigator(
        new InvestigationError(
          INVESTIGATION_ERROR_CODE.HALLUCINATED_EVIDENCE,
          "Output referenced an identifier that is not in the supplied context",
        ),
      ),
    });
    const posted = await app.request(
      `/exceptions/${exception.exceptionId}/investigate`,
      { method: "POST" },
    );
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as {
      investigation: {
        investigator: string;
        result: { evidence: Array<{ sourceId: string }> };
      };
    };
    expect(body.investigation.investigator).toBe("unavailable");
    expect(
      body.investigation.result.evidence.every(
        (item) => item.sourceId === exception.exceptionId,
      ),
    ).toBe(true);
  });

  it("uses UnavailableInvestigator when none is configured", async () => {
    const repository = new MemoryWebhookEventRepository();
    const exceptions = new MemoryExceptionRepository();
    const investigations = new MemoryInvestigationRepository();
    const payments = new MemoryPaymentRepository();
    const { exception } = await seedException(repository, exceptions, payments);
    const app = appOf({
      repository,
      exceptions,
      investigations,
      payments,
    });
    const posted = await app.request(
      `/exceptions/${exception.exceptionId}/investigate`,
      { method: "POST" },
    );
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as {
      investigation: { investigator: string };
    };
    expect(body.investigation.investigator).toBe("unavailable");
    expect(new UnavailableInvestigator().implementation).toBe("unavailable");
  });

  it("returns 404 when the exception does not exist", async () => {
    const app = appOf({
      repository: new MemoryWebhookEventRepository(),
      exceptions: new MemoryExceptionRepository(),
      investigations: new MemoryInvestigationRepository(),
      payments: new MemoryPaymentRepository(),
      investigator: new StubInvestigator(),
    });
    const posted = await app.request(
      "/exceptions/ffffffff-ffff-4fff-8fff-ffffffffffff/investigate",
      { method: "POST" },
    );
    expect(posted.status).toBe(404);
  });
});
