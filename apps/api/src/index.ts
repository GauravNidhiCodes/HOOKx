import { serve } from "@hono/node-server";
import { app } from "./app.js";

const host = process.env["HOOKX_API_HOST"] ?? "127.0.0.1";
const port = Number.parseInt(process.env["HOOKX_API_PORT"] ?? "8787", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("HOOKX_API_PORT must be a positive integer");
}

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  process.stdout.write(`HOOKX API foundation listening on http://${info.address}:${info.port}\n`);
});
