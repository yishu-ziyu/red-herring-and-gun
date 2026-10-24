import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = "http://127.0.0.1:3100";
const proxy = {
  target,
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@shared\/(.*)$/, replacement: fileURLToPath(new URL("../../apps/shared/", import.meta.url)) + "$1" },
      { find: /^typebox$/, replacement: fileURLToPath(new URL("./node_modules/typebox/build/index.mjs", import.meta.url)) },
      { find: /^typebox\/value$/, replacement: fileURLToPath(new URL("./node_modules/typebox/build/value/index.mjs", import.meta.url)) },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5203,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
    proxy: { "/api": proxy, "/s/": proxy },
  },
});
