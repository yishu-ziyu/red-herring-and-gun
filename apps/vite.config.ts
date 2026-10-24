import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";

/**
 * Vite is the frontend only. Local /api (and /health, /s/:shareId) go to Express.
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
    "/s/": proxy,
  };
}

/**
 * Dev only: serves saved runs from dev-fixtures/ at /__fixtures/<name>.json for replay (`?part=…&run=<name>`).
 * `apply: "serve"` keeps the plugin, and the fixture files, out of `vite build`.
 */
function devFixtures(): Plugin {
  const dir = path.resolve(import.meta.dirname, "dev-fixtures");
  return {
    name: "rhg-dev-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__fixtures/", (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
        if (!/^[\w-]+\.json$/.test(name)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        readFile(path.join(dir, name))
          .then((body) => {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(body);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end();
          });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devFixtures()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  server: {
    proxy: apiProxy(mode),
  },
  preview: {
    allowedHosts: ["gun.yishuziyu.cn", "localhost", "127.0.0.1"],
    proxy: apiProxy(mode),
  },
}));
