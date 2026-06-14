import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHandlers } from "./handlers.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const env = process.env as Record<string, string>;
const handlers = createHandlers(env);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// API routes
app.post("/api/agent/expand", (req, res, next) => handlers.handler(req, res, next));
app.post("/api/agent/recursive-search", (req, res, next) => handlers.recursiveHandler(req, res, next));
app.post("/api/agent/sherlock-search", (req, res, next) => handlers.sherlockHandler(req, res, next));
app.post("/api/search/360", (req, res, next) => handlers.search360Handler(req, res, next));
app.post("/api/search/provider", (req, res, next) => handlers.searchProviderHandler(req, res, next));
app.post("/api/agent/orchestrate", (req, res, next) => handlers.orchestrateHandler(req, res, next));
app.post("/api/agent/orchestrate-stream", (req, res, next) => handlers.orchestrateStreamHandler(req, res, next));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Red Herring API Server running on http://0.0.0.0:${PORT}`);
});
