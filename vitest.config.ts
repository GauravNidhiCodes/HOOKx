import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@hookx/exceptions/catalog",
        replacement: path.join(root, "packages/exceptions/src/catalog.ts"),
      },
      { find: "@hookx/audit", replacement: path.join(root, "packages/audit/src/index.ts") },
      { find: "@hookx/domain", replacement: path.join(root, "packages/domain/src/index.ts") },
      { find: "@hookx/webhook", replacement: path.join(root, "packages/webhook/src/index.ts") },
      {
        find: "@hookx/state-machine",
        replacement: path.join(root, "packages/state-machine/src/index.ts"),
      },
      { find: "@hookx/testkit", replacement: path.join(root, "packages/testkit/src/index.ts") },
      { find: "@hookx/storage", replacement: path.join(root, "packages/storage/src/index.ts") },
      { find: "@hookx/simulator", replacement: path.join(root, "packages/simulator/src/index.ts") },
      {
        find: /^@hookx\/exceptions$/,
        replacement: path.join(root, "packages/exceptions/src/index.ts"),
      },
      {
        find: "@hookx/investigation",
        replacement: path.join(root, "packages/investigation/src/index.ts"),
      },
    ],
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
    ],
    environmentMatchGlobs: [["apps/web/src/**/*.test.tsx", "jsdom"]],
  },
});
