import { defineConfig } from "vitest/config";
import path from "path";

const projectRoot = path.resolve(import.meta.dirname);

/**
 * Default test configuration.
 *
 * The default suite is deliberately deterministic: no database, cache, email,
 * browser, or external-provider calls are permitted. Tests requiring configured
 * infrastructure live behind explicit scripts documented in TESTING.md.
 */
export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "client", "src"),
      "@shared": path.resolve(projectRoot, "shared"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: [
      "server/keyword-cache.test.ts",
      "server/modelShortLabel.test.ts",
      "server/restartAllError.test.ts",
      "server/scheduler.test.ts",
      "server/sprint11-13.test.ts",
      "server/sprint14-admin.test.ts",
      "server/trainingSafety.test.ts",
      "server/trainingSafety.integration.test.ts",
    ],
  },
});
