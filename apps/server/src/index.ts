import { resolve } from "node:path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHandlers } from "./handlers.js";
import { checksQuotaHandler } from "./lib/checkQuota.js";
import { quotaGate } from "./lib/quotaPolicy.js";
import { flushSnapshots, startSnapshotLoop } from "./lib/jsonSnapshot.js";
import { sessionSecretFromEnv } from "./lib/signedCookie.js";

dotenv.config();
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), "../.env.local") });

if (process.env.NODE_ENV === "production" && !sessionSecretFromEnv()) {
  console.error("SESSION_SECRET is required in production");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_CORS_ORIGINS =
  "https://gun.yishuziyu.cn,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5180,http://127.0.0.1:5180";
const corsAllowlist = (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin && origin !== "*");
const allowedOrigins = corsAllowlist.length > 0 ? corsAllowlist : DEFAULT_CORS_ORIGINS.split(",");

app.use(
  cors({
    origin(origin, callback) {
      if (origin && allowedOrigins.includes(origin)) {
        callback(null, origin);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

const env = process.env as Record<string, string>;
const handlers = createHandlers(env);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// API routes
app.post(
  "/api/agent/orchestrate-stream",
  quotaGate("/api/agent/orchestrate-stream"),
  (req, res, next) => handlers.orchestrateStreamHandler(req, res, next)
);

app.get("/api/checks/quota", (req, res, next) => checksQuotaHandler(req, res).catch(next));

import { renderShareHtmlHandler } from "./lib/shareHandlers.js";

app.get("/api/investigations/:runId/events", (req, res, next) => handlers.investigationEventsHandler(req, res, next));
app.get("/api/investigations/:runId", (req, res, next) => handlers.getInvestigationHandler(req, res, next));
app.post("/api/investigations/:runId/cancel", (req, res, next) => handlers.cancelInvestigationHandler(req, res, next));
app.post("/api/investigations/:runId/shares", (req, res, next) => handlers.createShareHandler(req, res).catch(next));
app.delete("/api/investigations/:runId/shares/:shareId", (req, res, next) => handlers.revokeShareHandler(req, res).catch(next));
app.get("/s/:shareId", (req, res, next) => renderShareHtmlHandler(req, res).catch(next));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Red Herring API Server running on http://0.0.0.0:${PORT}`);
  // D1：周期快照落盘 + 退出前 flush（SIGTERM 也覆盖 tsx watch 的热重载）
  startSnapshotLoop();
  let flushed = false;
  const flushAndExit = () => {
    if (flushed) return;
    flushed = true;
    flushSnapshots();
    process.exit(0);
  };
  process.on("SIGTERM", flushAndExit);
  process.on("SIGINT", flushAndExit);
});
