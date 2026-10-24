import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";

const api: ProxyOptions = {
  target: "http://127.0.0.1:3100",
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
  configure(proxyServer) {
    proxyServer.on("proxyRes", (proxyRes) => {
      if (String(proxyRes.headers["content-type"] || "").includes("text/event-stream")) {
        proxyRes.headers["cache-control"] = "no-cache, no-transform";
      }
    });
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../../apps/shared", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5202,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
    proxy: { "/api": api, "/s/": api },
  },
});
