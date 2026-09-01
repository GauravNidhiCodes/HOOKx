import {
  openWebhookEventStore,
  redactDatabaseUrl,
  resolveDatabaseUrl,
  runRetryTick,
} from "@hookx/storage";
import { systemClock } from "./clock.js";
import { resolveRetryRuntimeConfig } from "./config.js";

async function start(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(process.env, "HOOKX_DATABASE_URL");
  const retryConfig = resolveRetryRuntimeConfig(process.env);
  const store = await openWebhookEventStore({ url: databaseUrl });
  try {
    const result = await runRetryTick(
      {
        retry: store.retry,
        events: store.repository,
        policy: retryConfig.policy,
        leaseMs: retryConfig.leaseMs,
        audit: store.audit,
        persistOutcome: store.persistOutcome,
        actor: "RETRY_WORKER",
        exceptions: store.exceptions,
      },
      systemClock().now(),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await store.close();
  }
}

start().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "HOOKX retry worker failed";
  process.stderr.write(`${redactDatabaseUrl(message)}\n`);
  process.exitCode = 1;
});
