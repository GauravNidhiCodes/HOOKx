import { Hono } from "hono";
import type { Clock } from "./clock.js";
import { handleWebhookPost } from "./http/webhooks.js";
import type { IngestDependencies } from "./ingest/ingest-webhook.js";

export type ApiDependencies = IngestDependencies & {
  readonly clock: Clock;
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
    });
  });

  app.post("/webhooks/:provider", (c) => handleWebhookPost(c, dependencies));

  return app;
}
