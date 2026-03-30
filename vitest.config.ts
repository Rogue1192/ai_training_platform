import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

const templateRoot = path.resolve(import.meta.dirname);

// Load .env file for tests
config({ path: path.resolve(templateRoot, ".env") });

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
