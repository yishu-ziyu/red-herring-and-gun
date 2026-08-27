import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

/**
 * Vite is the frontend only. Local /api (and /health /mcp /r) go to Express.
 * Start both with `npm run dev` (see scripts/dev.mjs).
 */
function apiProxy(mode: string): Record<string, ProxyOptions> {
  const env = loadEnv(mode, process.cwd(), "");
  const target = (env.API_ORIGIN || process.env.API_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "");
  const proxy: ProxyOptions = {
    target,
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
    configure(proxyServer) {
      proxyServer.on("proxyRes", (proxyRes) => {
        const contentType = String(proxyRes.headers["content-type"] || "");
        if (contentType.includes("text/event-stream")) {
          proxyRes.headers["cache-control"] = "no-cache, no-transform";
          proxyRes.headers["x-accel-buffering"] = "no";
        }
      });
    },
  };
  return {
    "/api": proxy,
    "/health": proxy,
    "/mcp": proxy,
    "/r": proxy,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: apiProxy(mode),
  },
  preview: {
    allowedHosts: ["gun.yishuziyu.cn", "localhost", "127.0.0.1"],
    proxy: apiProxy(mode),
  },
}));
