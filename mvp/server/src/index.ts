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
  fetchAipingApiKeys,
  fetchAipingUserInfo,
  getAipingConfig,
  readSessionCookie,
  readStateCookie,
  setSessionCookie,
  setStateCookie,
} from "./lib/aipingAuth.js";
import { mcpHttpHandler } from "./lib/mixerMcp.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const env = process.env as Record<string, string>;
const handlers = createHandlers(env);
const aipingConfig = getAipingConfig(env);

function redactAipingApiKeys(data: unknown) {
  if (!data || typeof data !== "object" || !("apikeyBaseInfo" in data)) return data;
  const payload = data as { apikeyBaseInfo?: unknown };
  if (!Array.isArray(payload.apikeyBaseInfo)) return data;
  return {
    ...payload,
    apikeyBaseInfo: payload.apikeyBaseInfo.map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = item as Record<string, unknown>;
      const apiKey = typeof record.apikey === "string" ? record.apikey : "";
      return {
        ...record,
        apikey: apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : "",
      };
    }),
  };
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.all("/mcp", (req, res) => {
  void mcpHttpHandler(req, res, env);
});

app.get("/api/auth/aiping/config", (_req, res) => {
  res.json({
    enabled: aipingConfig.enabled,
    provider: "aiping",
    loginUrl: "/api/auth/aiping/login",
    callbackUrl: aipingConfig.redirectUri,
    scope: aipingConfig.scope,
  });
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

app.get("/api/auth/aiping/apikeys", async (req, res) => {
  if (!aipingConfig.enabled) {
    res.status(503).json({ error: "AI Ping OAuth is not configured" });
    return;
  }

  const session = readSessionCookie(req, aipingConfig);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const data = await fetchAipingApiKeys(aipingConfig, session.accessToken);
    res.json(redactAipingApiKeys(data));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "AI Ping apikey list failed" });
  }
});

// API routes
app.post("/api/agent/expand", (req, res, next) => handlers.handler(req, res, next));
app.post("/api/agent/recursive-search", (req, res, next) => handlers.recursiveHandler(req, res, next));
app.post("/api/agent/sherlock-search", (req, res, next) => handlers.sherlockHandler(req, res, next));
app.post("/api/search/360", (req, res, next) => handlers.search360Handler(req, res, next));
app.post("/api/search/provider", (req, res, next) => handlers.searchProviderHandler(req, res, next));
app.post("/api/agent/orchestrate", (req, res, next) => handlers.orchestrateHandler(req, res, next));
app.post("/api/agent/orchestrate-stream", (req, res, next) => handlers.orchestrateStreamHandler(req, res, next));
app.get("/api/models/list", (req, res, next) => handlers.modelsListHandler(req, res, next));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Red Herring API Server running on http://0.0.0.0:${PORT}`);
});
