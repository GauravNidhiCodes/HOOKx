import { Hono } from "hono";

export const app = new Hono();

app.get("/", (c) => {
  return c.json({
    service: "hookx-api",
    product: "HOOKX",
    fullName: "HOOKX — Payment Webhook Reliability Engine",
    status: "foundation",
    ingest: "unavailable",
  });
});
