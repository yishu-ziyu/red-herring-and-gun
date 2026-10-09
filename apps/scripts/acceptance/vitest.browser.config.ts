import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["scripts/acceptance/public-sse.browser.ts"],
  environment: "node", testTimeout: 60000, hookTimeout: 60000,
  fileParallelism: false,
} });
