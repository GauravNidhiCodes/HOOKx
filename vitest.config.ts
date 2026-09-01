import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@hookx/audit": path.join(root, "packages/audit/src/index.ts"),
      "@hookx/domain": path.join(root, "packages/domain/src/index.ts"),
      "@hookx/webhook": path.join(root, "packages/webhook/src/index.ts"),
      "@hookx/state-machine": path.join(root, "packages/state-machine/src/index.ts"),
      "@hookx/testkit": path.join(root, "packages/testkit/src/index.ts"),
      "@hookx/storage": path.join(root, "packages/storage/src/index.ts"),
      "@hookx/simulator": path.join(root, "packages/simulator/src/index.ts"),
      "@hookx/exceptions": path.join(root, "packages/exceptions/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
