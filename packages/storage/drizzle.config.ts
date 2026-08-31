import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/webhook-events.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["HOOKX_DATABASE_URL"] ?? "postgres://127.0.0.1:5432/hookx",
  },
});
