import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

const projectRoot = path.resolve(import.meta.dirname);
config({ path: path.resolve(projectRoot, ".env") });

/**
 * Explicit opt-in checks that require configured external infrastructure.
 * Never include these in the default local test command.
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
      "server/supabase-db.test.ts",
      "server/supabase.test.ts",
      "server/redis.test.ts",
      "server/resend-api-key.test.ts",
      "server/dataforseo.test.ts",
      "server/sinbyte-api-key.test.ts",
    ],
  },
});
