import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHandlers } from "./handlers.js";
import {
  buildAuthorizeUrl,
  clearSessionCookie,
  clearStateCookie,
  createOauthState,
  exchangeCodeForToken,
  fetchAipingUserInfo,
  getAipingConfig,
  readSessionCookie,
  readStateCookie,
  setSessionCookie,
  setStateCookie,
} from "./lib/aipingAuth.js";
import { mcpHttpHandler } from "./lib/mixerMcp.js";
import {
  accountDeleteHandler,
  accountExportHandler,
  emailLogoutHandler,
  emailMeHandler,
  emailProfileHandler,
  emailRequestHandler,
  emailVerifyHandler,
} from "./lib/emailAuthHandlers.js";
import { checksQuotaHandler, gateFreeCheck } from "./lib/checkQuota.js";
import { readEmailAccountOptional } from "./lib/emailSession.js";

dotenv.config();
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), "../.env.local") });

if (process.env.NODE_ENV === "production" && !(process.env.AIPING_SESSION_SECRET ?? "").trim()) {
  console.error("AIPING_SESSION_SECRET is required in production");
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

const env = process.env as Record<string, string>;
const handlers = createHandlers(env);
const aipingConfig = getAipingConfig(env);

async function requireQuota(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ticket = await gateFreeCheck(req, res);
  if (!ticket) return;
  (req as express.Request & { checkTicket?: typeof ticket }).checkTicket = ticket;
  next();
}

async function requireIdentity(req: express.Request, res: express.Response, next: express.NextFunction) {
  const account = await readEmailAccountOptional(req);
  if (account) {
    next();
    return;
  }
  const session = readSessionCookie(req, aipingConfig);
  if (session) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.all("/mcp", requireQuota, (req, res) => {
  void mcpHttpHandler(req, res, env);
});

app.get("/api/auth/aiping/login", (req, res) => {
  if (!aipingConfig.enabled) {
    res.status(503).json({
      error: "AI Ping OAuth is not configured",
      requiredEnv: ["AIPING_CLIENT_ID", "AIPING_CLIENT_SECRET", "AIPING_SESSION_SECRET"],
    });
    return;
  }

  const statePayload = createOauthState(typeof req.query.next === "string" ? req.query.next : "/");
  setStateCookie(res, aipingConfig, statePayload);
  res.redirect(buildAuthorizeUrl(aipingConfig, statePayload.id));
});

app.get("/api/auth/aiping/callback", async (req, res) => {
  if (!aipingConfig.enabled) {
    res.status(503).send("AI Ping OAuth is not configured");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const statePayload = readStateCookie(req, aipingConfig);
  clearStateCookie(res);

  if (!code || !statePayload || statePayload.id !== state || Date.now() - statePayload.createdAt > 10 * 60 * 1000) {
    res.status(400).send("AI Ping OAuth state is invalid or expired");
    return;
  }

  try {
    const token = await exchangeCodeForToken(aipingConfig, code);
    const user = await fetchAipingUserInfo(aipingConfig, token.access_token);
    const now = Date.now();
    setSessionCookie(res, aipingConfig, {
      user,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expiry || (token.expires_in ? now + Number(token.expires_in) * 1000 : undefined),
      createdAt: now,
    });
    res.redirect(statePayload.next || "/");
  } catch (error) {
    res.status(502).send(error instanceof Error ? error.message : "AI Ping OAuth callback failed");
  }
});

app.get("/api/auth/me", (req, res) => {
  if (!aipingConfig.enabled) {
    res.json({ authenticated: false, enabled: false });
    return;
  }

  const session = readSessionCookie(req, aipingConfig);
  if (!session) {
    res.json({ authenticated: false, enabled: true, loginUrl: "/api/auth/aiping/login" });
    return;
  }

  res.json({
    authenticated: true,
    enabled: true,
    provider: "aiping",
    user: session.user,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
});

app.post("/api/auth/logout", (req, res) => {
  void req;
  clearSessionCookie(res);
  res.json({ ok: true });
});

// API routes
app.post("/api/agent/orchestrate-stream", requireQuota, (req, res, next) => handlers.orchestrateStreamHandler(req, res, next));
app.post("/api/agent/batch", requireQuota, (req, res, next) => handlers.batchHandler(req, res, next));
if (process.env.NODE_ENV === "production") {
  app.post("/api/agent/test-llm", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
} else {
  app.post("/api/agent/test-llm", requireQuota, (req, res, next) => handlers.testLlmHandler(req, res, next));
}
app.get("/api/models/list", (req, res, next) => handlers.modelsListHandler(req, res, next));
app.get("/api/models/health", requireQuota, (req, res, next) => handlers.modelsHealthHandler(req, res, next));
app.post("/api/agent/memory-candidates", requireIdentity, (req, res, next) => updateMemoryCandidateHandler(req, res).catch(next));

// v3 邮箱登录 + 账号数据（用 email 前缀避开与 AI Ping /api/auth/{me,logout} 的第一匹配冲突）
app.post("/api/auth/email/request", (req, res, next) => emailRequestHandler(req, res).catch(next));
app.post("/api/auth/email/verify", (req, res, next) => emailVerifyHandler(req, res).catch(next));
app.get("/api/auth/email/me", (req, res, next) => emailMeHandler(req, res).catch(next));
app.patch("/api/auth/email/profile", (req, res, next) => emailProfileHandler(req, res).catch(next));
app.post("/api/auth/email/logout", (req, res, next) => emailLogoutHandler(req, res).catch(next));
app.get("/api/checks/quota", (req, res, next) => checksQuotaHandler(req, res).catch(next));
app.get("/api/account/export", (req, res, next) => accountExportHandler(req, res).catch(next));
app.delete("/api/account", (req, res, next) => accountDeleteHandler(req, res).catch(next));

// Plan Item 2 · 报告 URL 永久路由 /r/:caseId
import {
  postCaseHandler,
  getCaseHandler,
  renderCaseHtmlHandler,
  listCasesHandler,
} from "./lib/caseHandlers.js";
import {
  updateMemoryCandidateHandler,
} from "./lib/memoryCandidateHandlers.js";
import { appendUserFeedback } from "./lib/userFeedback.js";

app.post("/api/case", (req, res, next) => postCaseHandler(req, res).catch(next));
app.post("/api/feedback", (req, res, next) => postGeneralFeedbackHandler(req, res).catch(next));
app.get("/api/case/:caseId", (req, res, next) => getCaseHandler(req, res));
app.get("/api/cases", (req, res, next) => listCasesHandler(req, res));
app.get("/r/:caseId", (req, res, next) => renderCaseHtmlHandler(req, res));

/** POST /api/feedback — 用户对某次判断的异议。落在 RHG_DATA_DIR，供 golden 反向采集。 */
async function postGeneralFeedbackHandler(req: any, res: any): Promise<void> {
  const body = (req.body ?? {}) as { claim?: unknown; verdictType?: unknown; score?: unknown; reason?: unknown };
  const claim = String(body.claim ?? "").trim().slice(0, 2000);
  const reason = String(body.reason ?? "").trim().slice(0, 2000);
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }
  await appendUserFeedback(env, {
    kind: "general",
    claim,
    verdictType: typeof body.verdictType === "string" ? body.verdictType : undefined,
    score: typeof body.score === "number" ? body.score : undefined,
    reason,
  });
  res.json({ ok: true });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Red Herring API Server running on http://0.0.0.0:${PORT}`);
});
