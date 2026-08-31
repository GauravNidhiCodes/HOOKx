import { Hono } from "hono";
import type { AuditRepository, RetryRepository } from "@hookx/storage";
import type { Clock } from "./clock.js";
import {
  handleCorrelationAudit,
  handlePaymentAudit,
  handleWebhookAudit,
} from "./http/audit.js";
import {
  handleGetDeadLetter,
  handleGetRetry,
  handleListDeadLetters,
  handleListRetries,
} from "./http/retries.js";
import { handleWebhookPost } from "./http/webhooks.js";
import type { IngestDependencies } from "./ingest/ingest-webhook.js";

export type ApiDependencies = IngestDependencies & {
  readonly clock: Clock;
  readonly retry: RetryRepository;
  readonly audit: AuditRepository;
};

export function createApp(dependencies: ApiDependencies): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      service: "hookx-api",
      product: "HOOKX",
      fullName: "HOOKX — Payment Webhook Reliability Engine",
      status: "ok",
      ingest: "/webhooks/:provider",
      retries: "/retries",
      deadLetters: "/dead-letters",
      paymentAudit: "/payments/:paymentId/audit",
      webhookAudit: "/webhooks/:webhookEventId/audit",
    });
  });

  app.post("/webhooks/:provider", (c) => handleWebhookPost(c, dependencies));
  app.get("/webhooks/:webhookEventId/audit", (c) =>
    handleWebhookAudit(c, dependencies),
  );
  app.get("/retries", (c) => handleListRetries(c, dependencies));
  app.get("/retries/:webhookEventId", (c) => handleGetRetry(c, dependencies));
  app.get("/dead-letters", (c) => handleListDeadLetters(c, dependencies));
  app.get("/dead-letters/:webhookEventId", (c) =>
    handleGetDeadLetter(c, dependencies),
  );
  app.get("/payments/:paymentId/audit", (c) =>
    handlePaymentAudit(c, dependencies),
  );
  app.get("/audit", (c) => handleCorrelationAudit(c, dependencies));

  return app;
}
