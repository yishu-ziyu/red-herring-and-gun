/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const casefile = fileURLToPath(new URL("../core/src/casefile/index.ts", import.meta.url));
const publicCopy = fileURLToPath(new URL("../core/src/text/publicCopy.ts", import.meta.url));

const fixtureArg = process.argv.find((arg) => arg.startsWith("--fixture="));
const fixtureName = fixtureArg?.slice("--fixture=".length);

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "@rhg/core/casefile": casefile,
      "@rhg/core/publicCopy": publicCopy,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT ?? "3100"}`,
        changeOrigin: true,
      },
    },
    ...(fixtureName ? { open: `/cases/fx-${fixtureName}` } : {}),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
