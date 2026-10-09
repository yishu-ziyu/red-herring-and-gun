import { resolve } from "node:path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHandlers } from "./handlers.js";
import {
  accountDeleteHandler,
  accountExportHandler,
  emailLogoutHandler,
  emailMeHandler,
  emailProfileHandler,
  emailRequestHandler,
  emailVerifyHandler,
} from "./lib/emailAuthHandlers.js";
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

// v3 邮箱登录 + 账号数据
app.post("/api/auth/email/request", (req, res, next) => emailRequestHandler(req, res).catch(next));
app.post("/api/auth/email/verify", (req, res, next) => emailVerifyHandler(req, res).catch(next));
app.get("/api/auth/email/me", (req, res, next) => emailMeHandler(req, res).catch(next));
app.patch("/api/auth/email/profile", (req, res, next) => emailProfileHandler(req, res).catch(next));
app.post("/api/auth/email/logout", (req, res, next) => emailLogoutHandler(req, res).catch(next));
app.get("/api/checks/quota", (req, res, next) => checksQuotaHandler(req, res).catch(next));
app.get("/api/account/export", (req, res, next) => accountExportHandler(req, res).catch(next));
app.delete("/api/account", (req, res, next) => accountDeleteHandler(req, res).catch(next));

import {
  postCaseHandler,
  getCaseHandler,
  listCasesHandler,
} from "./lib/caseHandlers.js";
import { createShareHandler, previewShareHandler, revokeShareHandler, renderShareHtmlHandler } from "./lib/shareHandlers.js";

app.post("/api/case", (req, res, next) => postCaseHandler(req, res).catch(next));
app.get("/api/investigations/:runId/events", (req, res, next) => handlers.investigationEventsHandler(req, res, next));
app.get("/api/investigations/:runId", (req, res, next) => handlers.getInvestigationHandler(req, res, next));
app.post("/api/investigations/:runId/cancel", (req, res, next) => handlers.cancelInvestigationHandler(req, res, next));
app.get("/api/case/:caseId", (req, res, next) => getCaseHandler(req, res));
app.get("/api/cases", (req, res, next) => listCasesHandler(req, res));
app.get("/api/cases/:caseId/share-preview", (req, res, next) => previewShareHandler(req, res).catch(next));
app.post("/api/cases/:caseId/shares", (req, res, next) => createShareHandler(req, res).catch(next));
app.delete("/api/cases/:caseId/shares/:shareId", (req, res, next) => revokeShareHandler(req, res).catch(next));
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
