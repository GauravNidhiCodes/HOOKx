import { Hono } from "hono";
import type {
  AuditRepository,
  ExceptionRepository,
  FailureLabPurgeResult,
  InvestigationRepository,
  PaymentRepository,
  RetryRepository,
} from "@hookx/storage";
import type { Investigator } from "@hookx/investigation";
import {
  createProcessMetrics,
  silentLogger,
  type Logger,
  type ProcessMetrics,
} from "@hookx/observability";
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
  handleGetIncident,
  handleGetIncidentTimeline,
  handleListIncidents,
} from "./http/incidents.js";
import { handleHealth, handleReady } from "./http/health.js";
import { handleMetricsSummary } from "./http/metrics.js";
import {
  handleGetInvestigation,
  handleListInvestigations,
  handlePostInvestigate,
} from "./http/investigation.js";
import { handleWebhookPost } from "./http/webhooks.js";
import {
  handleFailureLabCatalog,
  handleFailureLabGetRun,
  handleFailureLabReset,
  handleFailureLabRun,
} from "./failure-lab/http.js";
import type { FailureLabRunReport } from "./failure-lab/report.js";
import type { ProcessIncomingWebhookDependencies } from "./pipeline/process-incoming-webhook.js";

export type ApiDependencies = ProcessIncomingWebhookDependencies & {
  readonly clock: Clock;
  readonly retry: RetryRepository;
  readonly audit: AuditRepository;
  readonly payments?: PaymentRepository;
  readonly exceptions?: ExceptionRepository;
  readonly investigations?: InvestigationRepository;
  readonly investigator?: Investigator;
  readonly logger?: Logger;
  readonly metrics?: ProcessMetrics;
  readonly ping?: () => Promise<void>;
  readonly liveProviders?: readonly string[];
  readonly syntheticWebhookSecret?: string;
  readonly purgeFailureLab?: () => Promise<FailureLabPurgeResult>;
};

export function createApp(dependencies: ApiDependencies): Hono {
  const app = new Hono();
  const logger = dependencies.logger ?? silentLogger();
  const metrics = dependencies.metrics ?? createProcessMetrics();
  const wired: ApiDependencies = {
    ...dependencies,
    logger,
    metrics,
  };
  const labRuns = new Map<string, FailureLabRunReport>();

  app.onError((_error, context) => {
    return context.json({ status: "error", code: "INTERNAL_ERROR" }, 500);
  });

  app.get("/", (c) => {
    return c.json({
      service: "hookx-api",
      product: "HOOKX",
      fullName: "HOOKX — Payment Webhook Reliability Engine",
      status: "ok",
      ingest: "/webhooks/:provider",
      health: "/health",
      ready: "/ready",
      metrics: "/metrics/summary",
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
      incidents: "/incidents",
      incident: "/incidents/:id",
      incidentTimeline: "/incidents/:id/timeline",
      failureLab: "/failure-lab",
      failureLabRun: "/failure-lab/run",
      investigate: "/exceptions/:id/investigate",
      investigation: "/exceptions/:id/investigation",
      incidentInvestigate: "/incidents/:id/investigate",
      incidentInvestigations: "/incidents/:id/investigations",
    });
  });

  app.get("/health", (c) => handleHealth(c));
  app.get("/ready", (c) => handleReady(c, wired.ping));
  app.get("/metrics/summary", (c) => handleMetricsSummary(c, wired));
  app.post("/webhooks/:provider", (c) => handleWebhookPost(c, wired));
  app.get("/webhooks", (c) => handleListWebhooks(c, wired));
  app.get("/webhooks/:webhookEventId/audit", (c) =>
    handleWebhookAudit(c, wired),
  );
  app.get("/webhooks/:webhookEventId", (c) =>
    handleGetWebhookEvent(c, wired),
  );
  app.get("/retries", (c) => handleListRetries(c, wired));
  app.get("/retries/:webhookEventId", (c) => handleGetRetry(c, wired));
  app.get("/dead-letters", (c) => handleListDeadLetters(c, wired));
  app.get("/dead-letters/:webhookEventId", (c) =>
    handleGetDeadLetter(c, wired),
  );
  app.get("/payments", (c) => handleListPayments(c, wired));
  app.get("/payments/:paymentId/webhooks", (c) =>
    handlePaymentWebhooks(c, wired),
  );
  app.get("/payments/:paymentId/audit", (c) =>
    handlePaymentAudit(c, wired),
  );
  app.get("/payments/:paymentId/exceptions", (c) =>
    handlePaymentExceptions(c, wired),
  );
  app.get("/payments/:paymentId", (c) => handleGetPayment(c, wired));
  app.post("/exceptions/:id/investigate", (c) =>
    handlePostInvestigate(c, wired),
  );
  app.get("/exceptions/:id/investigations", (c) =>
    handleListInvestigations(c, wired),
  );
  app.get("/exceptions/:id/investigation", (c) =>
    handleGetInvestigation(c, wired),
  );
  app.get("/exceptions/:id", (c) => handleGetException(c, wired));
  app.get("/exceptions", (c) => handleListExceptions(c, wired));
  app.post("/incidents/:id/investigate", (c) =>
    handlePostInvestigate(c, wired),
  );
  app.get("/incidents/:id/investigations", (c) =>
    handleListInvestigations(c, wired),
  );
  app.get("/incidents/:id/timeline", (c) =>
    handleGetIncidentTimeline(c, wired),
  );
  app.get("/incidents/:id", (c) => handleGetIncident(c, wired));
  app.get("/incidents", (c) => handleListIncidents(c, wired));
  app.get("/failure-lab", (c) => handleFailureLabCatalog(c));
  app.post("/failure-lab/run", (c) =>
    handleFailureLabRun(c, wired, labRuns, (processFn) =>
      createApp({
        ...wired,
        processPaymentEvents: processFn,
        retryPolicy: wired.retryPolicy,
      }),
    ),
  );
  app.get("/failure-lab/runs/:id", (c) => handleFailureLabGetRun(c, labRuns));
  app.post("/failure-lab/reset", (c) =>
    handleFailureLabReset(c, wired, labRuns),
  );
  app.get("/audit", (c) => handleCorrelationAudit(c, wired));

  return app;
}
