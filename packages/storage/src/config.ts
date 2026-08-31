import { StorageError } from "./errors.js";

export type DatabaseConfig = {
  readonly url: string;
};

const DATABASE_NAME = /^[a-z][a-z0-9_]*$/;
const RESERVED_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new StorageError(
      "MISSING_DATABASE_URL",
      `${key} is not set. See packages/storage/README.md`,
    );
  }
  return value;
}

export function redactDatabaseUrl(url: string): string {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

export function parseDatabaseName(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!DATABASE_NAME.test(name)) {
    throw new StorageError(
      "UNSAFE_DATABASE_NAME",
      "Database name must be lowercase letters, digits, and underscore",
    );
  }
  if (RESERVED_DATABASE_NAMES.has(name)) {
    throw new StorageError(
      "UNSAFE_DATABASE_NAME",
      "Refusing to use a PostgreSQL maintenance database",
    );
  }
  return name;
}

export function toMaintenanceDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

export function defaultTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env["HOOKX_TEST_DATABASE_URL"];
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  const user = env["USER"] ?? "postgres";
  return `postgres://${encodeURIComponent(user)}@127.0.0.1:5432/hookx_test`;
}
