import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../..");

export default defineConfig({
  plugins: [react()],
  envDir: repo,
  resolve: {
    alias: [
      {
        find: "@hookx/exceptions/catalog",
        replacement: path.join(repo, "packages/exceptions/src/catalog.ts"),
      },
      { find: "@hookx/audit", replacement: path.join(repo, "packages/audit/src/index.ts") },
      { find: "@hookx/domain", replacement: path.join(repo, "packages/domain/src/index.ts") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/exceptions": "http://127.0.0.1:8787",
      "/payments": "http://127.0.0.1:8787",
      "/webhooks": "http://127.0.0.1:8787",
      "/retries": "http://127.0.0.1:8787",
      "/dead-letters": "http://127.0.0.1:8787",
      "/audit": "http://127.0.0.1:8787",
    },
  },
});
