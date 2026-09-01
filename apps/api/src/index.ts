import { serve } from "@hono/node-server";
import { createInvestigatorFromEnv } from "@hookx/investigation";
import { redactDatabaseUrl, resolveDatabaseUrl } from "@hookx/storage";
import { openWebhookEventStore } from "@hookx/storage";
import { createSignatureVerifierRegistry } from "@hookx/webhook";
import { createJsonLogger, createProcessMetrics } from "@hookx/observability";
import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import {
  resolveLiveProviders,
  resolveRetryRuntimeConfig,
  resolveRazorpayWebhookSecret,
  resolveSyntheticWebhookSecret,
  resolveSyntheticWebhookToleranceSeconds,
} from "./config.js";

const host = process.env["HOOKX_API_HOST"] ?? "127.0.0.1";
const port = Number.parseInt(process.env["HOOKX_API_PORT"] ?? "8787", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("HOOKX_API_PORT must be a positive integer");
}

async function start(): Promise<void> {
  const secret = resolveSyntheticWebhookSecret(process.env);
  const databaseUrl = resolveDatabaseUrl(process.env, "HOOKX_DATABASE_URL");
  const retryConfig = resolveRetryRuntimeConfig(process.env);
  const store = await openWebhookEventStore({ url: databaseUrl });
  const logger = createJsonLogger({
    write: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
  const metrics = createProcessMetrics();
  const app = createApp({
    verifiers: createSignatureVerifierRegistry({
      syntheticSecret: secret,
      syntheticToleranceSeconds: resolveSyntheticWebhookToleranceSeconds(
        process.env,
      ),
      razorpayWebhookSecret: resolveRazorpayWebhookSecret(process.env),
    }),
    repository: store.repository,
    retry: store.retry,
    audit: store.audit,
    payments: store.payments,
    persistOutcome: store.persistOutcome,
    exceptions: store.exceptions,
    investigations: store.investigations,
    investigator: createInvestigatorFromEnv(process.env),
    retryPolicy: retryConfig.policy,
    leaseMs: retryConfig.leaseMs,
    clock: systemClock(),
    logger,
    metrics,
    ping: () => store.ping(),
    liveProviders: resolveLiveProviders(process.env),
  });

  serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    process.stdout.write(
      `HOOKX API listening on http://${info.address}:${info.port}\n`,
    );
  });
}

start().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "HOOKX API failed to start";
  process.stderr.write(`${redactDatabaseUrl(message)}\n`);
  process.exitCode = 1;
});
