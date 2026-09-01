import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConfig } from "./config.js";
import { parseDatabaseName, toMaintenanceDatabaseUrl } from "./config.js";
import { DrizzleAuditRepository } from "./audit/drizzle-audit-repository.js";
import { createDrizzleOutcomeWriter } from "./audit/persist-outcome.js";
import type { AuditRepository, PersistOutcomeFn } from "./audit/repository.js";
import { DrizzlePaymentRepository } from "./payment/drizzle-payment-repository.js";
import type { PaymentRepository } from "./payment/repository.js";
import { DrizzleRetryRepository } from "./retry/drizzle-retry-repository.js";
import type { RetryRepository } from "./retry/repository.js";
import { DrizzleWebhookEventRepository } from "./drizzle-webhook-event-repository.js";
import type { WebhookEventRepository } from "./repository.js";

export type WebhookEventStore = {
  readonly repository: WebhookEventRepository;
  readonly retry: RetryRepository;
  readonly audit: AuditRepository;
  readonly payments: PaymentRepository;
  readonly persistOutcome: PersistOutcomeFn;
  close(): Promise<void>;
};

function migrationsFolder(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

function createPool(url: string): Pool {
  return new Pool({
    connectionString: url,
    max: 10,
  });
}

export async function openWebhookEventStore(
  config: DatabaseConfig,
): Promise<WebhookEventStore> {
  const pool = createPool(config.url);
  const db = drizzle(pool);
  return {
    repository: new DrizzleWebhookEventRepository(db),
    retry: new DrizzleRetryRepository(db),
    audit: new DrizzleAuditRepository(db),
    payments: new DrizzlePaymentRepository(db),
    persistOutcome: createDrizzleOutcomeWriter(db),
    async close() {
      await pool.end();
    },
  };
}

export async function applyWebhookEventMigrations(
  config: DatabaseConfig,
): Promise<void> {
  const pool = createPool(config.url);
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}

export async function recreateDatabase(config: DatabaseConfig): Promise<void> {
  const databaseName = parseDatabaseName(config.url);
  const admin = createPool(toMaintenanceDatabaseUrl(config.url));
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
}
