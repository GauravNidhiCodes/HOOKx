import { Hono } from "hono";
import type {
  AuditRepository,
  ExceptionRepository,
  InvestigationRepository,
  PaymentRepository,
  RetryRepository,
} from "@hookx/storage";
import type { Investigator } from "@hookx/investigation";
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
import { handleGetPayment, handleListPayments } from "./http/payments.js";
import {
  handleGetWebhookEvent,
  handleListWebhooks,
  handlePaymentWebhooks,
} from "./http/events.js";
import {
  handleGetException,
  handleListExceptions,
  handlePaymentExceptions,
} from "./http/exceptions.js";
import {
  handleGetInvestigation,
  handlePostInvestigate,
} from "./http/investigation.js";
import { handleWebhookPost } from "./http/webhooks.js";
import type { ProcessIncomingWebhookDependencies } from "./pipeline/process-incoming-webhook.js";

export type ApiDependencies = ProcessIncomingWebhookDependencies & {
  readonly clock: Clock;
  readonly retry: RetryRepository;
  readonly audit: AuditRepository;
  readonly payments?: PaymentRepository;
  readonly exceptions?: ExceptionRepository;
  readonly investigations?: InvestigationRepository;
  readonly investigator?: Investigator;
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
      payment: "/payments/:paymentId",
      payments: "/payments",
      paymentWebhooks: "/payments/:paymentId/webhooks",
      webhook: "/webhooks/:webhookEventId",
      webhooks: "/webhooks",
      paymentAudit: "/payments/:paymentId/audit",
      webhookAudit: "/webhooks/:webhookEventId/audit",
      exceptions: "/exceptions",
      paymentExceptions: "/payments/:paymentId/exceptions",
      investigate: "/exceptions/:id/investigate",
      investigation: "/exceptions/:id/investigation",
    });
  });

  app.post("/webhooks/:provider", (c) => handleWebhookPost(c, dependencies));
  app.get("/webhooks", (c) => handleListWebhooks(c, dependencies));
  app.get("/webhooks/:webhookEventId/audit", (c) =>
    handleWebhookAudit(c, dependencies),
  );
  app.get("/webhooks/:webhookEventId", (c) =>
    handleGetWebhookEvent(c, dependencies),
  );
  app.get("/retries", (c) => handleListRetries(c, dependencies));
  app.get("/retries/:webhookEventId", (c) => handleGetRetry(c, dependencies));
  app.get("/dead-letters", (c) => handleListDeadLetters(c, dependencies));
  app.get("/dead-letters/:webhookEventId", (c) =>
    handleGetDeadLetter(c, dependencies),
  );
  app.get("/payments", (c) => handleListPayments(c, dependencies));
  app.get("/payments/:paymentId/webhooks", (c) =>
    handlePaymentWebhooks(c, dependencies),
  );
  app.get("/payments/:paymentId/audit", (c) =>
    handlePaymentAudit(c, dependencies),
  );
  app.get("/payments/:paymentId/exceptions", (c) =>
    handlePaymentExceptions(c, dependencies),
  );
  app.get("/payments/:paymentId", (c) => handleGetPayment(c, dependencies));
  app.post("/exceptions/:id/investigate", (c) =>
    handlePostInvestigate(c, dependencies),
  );
  app.get("/exceptions/:id/investigation", (c) =>
    handleGetInvestigation(c, dependencies),
  );
  app.get("/exceptions/:id", (c) => handleGetException(c, dependencies));
  app.get("/exceptions", (c) => handleListExceptions(c, dependencies));
  app.get("/audit", (c) => handleCorrelationAudit(c, dependencies));

  return app;
}
