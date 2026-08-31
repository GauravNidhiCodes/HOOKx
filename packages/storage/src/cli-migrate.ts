import { resolveDatabaseUrl } from "./config.js";
import { applyWebhookEventMigrations } from "./store.js";

const config = { url: resolveDatabaseUrl(process.env, "HOOKX_DATABASE_URL") };
await applyWebhookEventMigrations(config);
process.stdout.write("HOOKX webhook event migrations applied\n");
