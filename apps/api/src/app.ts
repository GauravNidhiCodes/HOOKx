import { Hono } from "hono";
import type { RetryRepository } from "@hookx/storage";
import type { Clock } from "./clock.js";
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
    });
  });

  app.post("/webhooks/:provider", (c) => handleWebhookPost(c, dependencies));
  app.get("/retries", (c) => handleListRetries(c, dependencies));
  app.get("/retries/:webhookEventId", (c) => handleGetRetry(c, dependencies));
  app.get("/dead-letters", (c) => handleListDeadLetters(c, dependencies));
  app.get("/dead-letters/:webhookEventId", (c) =>
    handleGetDeadLetter(c, dependencies),
  );

  return app;
}
