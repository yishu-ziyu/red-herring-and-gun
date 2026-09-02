import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

/**
 * Vite is the frontend only. Local /api (and /health /mcp /r/:caseId) go to Express.
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
    // 永久报告只代理 /r/:caseId；裸 /r 前缀会把 /result-preview 等前端路径
    // 也转给 Express，导致 Vite 无法回落到 index.html。
    "/r/": proxy,
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
