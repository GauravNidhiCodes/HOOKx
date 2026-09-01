import { describe, expect, it } from "vitest";
import { instant, paymentId, providerId } from "@hookx/domain";
import { createExceptionDraft } from "@hookx/exceptions";
import { collectingLogger } from "@hookx/observability";
import {
  MemoryAuditRepository,
  MemoryExceptionRepository,
  MemoryRetryRepository,
} from "@hookx/storage";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createApp } from "../app.js";
import { fixedClock } from "../clock.js";
import { MemoryWebhookEventRepository } from "../test-support/memory-webhook-repository.js";

const NOW = instant("2026-01-15T10:00:01.000Z");
const SECRET = "dev-only-synthetic-webhook-secret";

function appWith(exceptions: MemoryExceptionRepository) {
  return createApp({
    repository: new MemoryWebhookEventRepository(),
    retry: new MemoryRetryRepository(),
    audit: new MemoryAuditRepository(),
    exceptions,
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: SECRET,
      syntheticToleranceSeconds: 300,
    }),
    clock: fixedClock(NOW),
    logger: collectingLogger([]),
  });
}

describe("GET incident routes", () => {
  it("lists incidents from persisted exceptions and hides secrets", async () => {
    const exceptions = new MemoryExceptionRepository();
    const created = await exceptions.create(
      createExceptionDraft({
        exceptionCode: "CONFLICTING_EVENT",
        paymentId: paymentId("SYNTHETIC:pay:inc-1"),
        webhookEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        provider: providerId("SYNTHETIC"),
        reason: "CONFLICTING_EVENT",
        detectedAt: NOW,
        correlationId: "corr-inc-1",
        metadata: {
          secret: "dev-only-not-a-real-secret",
          originalAuthoritative: true,
        },
      }),
    );
    const app = appWith(exceptions);

    const emptyOther = await app.request("/incidents?status=RESOLVED");
    expect(emptyOther.status).toBe(200);
    expect(
      ((await emptyOther.json()) as { incidents: unknown[] }).incidents,
    ).toEqual([]);

    const listed = await app.request(
      "/incidents?status=OPEN&severity=ERROR&exceptionCode=CONFLICTING_EVENT&provider=SYNTHETIC",
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      incidents: Array<{
        incidentId: string;
        exceptionCode: string;
        synthetic: boolean;
        eventId: string | null;
      }>;
    };
    expect(listedBody.incidents).toHaveLength(1);
    expect(listedBody.incidents[0]?.incidentId).toBe(created.record.exceptionId);
    expect(listedBody.incidents[0]?.exceptionCode).toBe("CONFLICTING_EVENT");
    expect(listedBody.incidents[0]?.synthetic).toBe(true);
    expect(listedBody.incidents[0]?.eventId).toBe(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const listedText = JSON.stringify(listedBody);
    expect(listedText).not.toContain("dev-only-not-a-real-secret");
    expect(listedText).not.toContain(SECRET);

    const one = await app.request(`/incidents/${created.record.exceptionId}`);
    expect(one.status).toBe(200);
    const oneBody = (await one.json()) as {
      incident: { incidentId: string; correlationId: string };
    };
    expect(oneBody.incident.incidentId).toBe(created.record.exceptionId);
    expect(oneBody.incident.correlationId).toBe("corr-inc-1");

    const timeline = await app.request(
      `/incidents/${created.record.exceptionId}/timeline`,
    );
    expect(timeline.status).toBe(200);
    const timelineBody = (await timeline.json()) as {
      incident: { incidentId: string };
      timeline: unknown[];
      page: { total: number; offset: number; limit: number };
    };
    expect(timelineBody.incident.incidentId).toBe(created.record.exceptionId);
    expect(timelineBody.page.offset).toBe(0);
    expect(Array.isArray(timelineBody.timeline)).toBe(true);
    expect(JSON.stringify(timelineBody)).not.toContain("dev-only-not-a-real-secret");
    expect(JSON.stringify(timelineBody)).not.toMatch(/"payload"/);

    const missing = await app.request(
      "/incidents/ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    expect(missing.status).toBe(404);

    const badDate = await app.request("/incidents?from=yesterday");
    expect(badDate.status).toBe(400);

    const byTime = await app.request(
      "/incidents?from=2026-01-15T10:00:01.000Z&to=2026-01-15T10:00:01.000Z",
    );
    expect(byTime.status).toBe(200);
    expect(
      ((await byTime.json()) as { incidents: unknown[] }).incidents,
    ).toHaveLength(1);
  });

  it("does not invent incidents when none are persisted", async () => {
    const app = appWith(new MemoryExceptionRepository());
    const listed = await app.request("/incidents");
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { incidents: unknown[] }).incidents,
    ).toEqual([]);
  });
});

describe("health and metrics", () => {
  it("keeps GET /health as a liveness check", async () => {
    const app = appWith(new MemoryExceptionRepository());
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    const ready = await app.request("/ready");
    expect(ready.status).toBe(503);
    const readyBody = (await ready.json()) as { status: string };
    expect(readyBody.status).not.toBe("ok");
  });

  it("returns only observed persisted and process counts", async () => {
    const app = appWith(new MemoryExceptionRepository());
    const response = await app.request("/metrics/summary");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      persisted: { source: string; webhookEvents: number };
      runtime: { source: string; counts: Record<string, number> };
    };
    expect(body.persisted.source).toBe("database");
    expect(body.persisted.webhookEvents).toBe(0);
    expect(body.runtime.source).toBe("process");
    expect(body.runtime.counts.webhooksReceived).toBe(0);
    expect(JSON.stringify(body)).not.toContain("uptime");
    expect(JSON.stringify(body)).not.toContain("successRate");
    expect(JSON.stringify(body)).not.toContain("SLA");
  });
});
