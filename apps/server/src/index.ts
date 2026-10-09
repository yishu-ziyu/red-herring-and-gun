import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readdir, rm, stat as statFile } from "node:fs/promises";
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

// 临时图床：以图搜图适配器把用户图片落盘到 UPLOAD_DIR（默认系统临时目录），
// 通过 /uploads 静态暴露给 reverse-image vendor 抓取。生产需 Nginx 转发 /uploads 并设 PUBLIC_BASE_URL。
app.use(
  "/uploads",
  express.static(join(process.env.UPLOAD_DIR || tmpdir(), "rhg-uploads"), {
    maxAge: "1h",
    index: false,
  })
);

// 有界清扫：启动时删掉 24h 前的临时上传图。一次性、无常驻任务；
// 图搜图回调只需几分钟内的可访问窗口，长跑进程不再无界累积。
const uploadRoot = join(process.env.UPLOAD_DIR || tmpdir(), "rhg-uploads");
void readdir(uploadRoot)
  .then((files) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Promise.all(
      files.map(async (name) => {
        const filePath = join(uploadRoot, name);
        try {
          const info = await statFile(filePath);
          if (info.mtimeMs < cutoff) await rm(filePath, { force: true });
        } catch {
          /* 单个文件失败不影响启动与其余文件 */
        }
      })
    );
  })
  .catch(() => {
    /* 目录不存在 = 没有历史文件 */
  });

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
if (process.env.NODE_ENV === "production") {
  app.post("/api/agent/test-llm", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
} else {
  app.post("/api/agent/test-llm", quotaGate("/api/agent/test-llm"), (req, res, next) => handlers.testLlmHandler(req, res, next));
}
app.get("/api/models/list", (req, res, next) => handlers.modelsListHandler(req, res, next));
// 可用性探针不计入每日核查额度：输入页每次加载都会调它，计进去会让访客打开一次首页就用光配额。
// 闸门判定来源 lib/quotaPolicy.ts，契约 docs/evals/2026-09-11-health-probe-quota.md。
app.get("/api/models/health", (req, res, next) => handlers.modelsHealthHandler(req, res, next));

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
